import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { CategoriesRepository, IngredientsRepository } from "@fridgeezy/supabase";
import { ingredientCanonicalId, splitIngredientName } from "@fridgeezy/toolkit";

import { trackBackgroundTask } from "../../../background-tasks";
import { classifyNewIngredients } from "../../ingredients/services";

import { adjudicateIngredient } from "./adjudicate-ingredient";

// Calibrated from real ingredient name-embedding similarity (see
// evals/calibrate-ingredients). Name-only embeddings are a weak synonym signal:
// true synonyms score LOW (scallion↔green onion ~0.68, cilantro↔coriander ~0.68,
// bell pepper↔capsicum ~0.62) — mostly below the old 0.70 floor, so they never
// reached the LLM and got created as duplicates. Distinct-but-related pairs
// (chicken breast↔thigh ~0.70) can score higher, so there's no clean cutoff — the
// LLM is the real discriminator. Keep ACCEPT high (auto-accept only near-identical,
// above the "same base, more specific" confound like olive oil↔EVOO ~0.75), and
// drop the gray floor so synonyms actually reach adjudication.
/** Cosine similarity at or above which a vector match is auto-accepted (no LLM). */
const ACCEPT_THRESHOLD = 0.85;
/**
 * Lower bound of the "gray band". Candidates in [GRAY_BAND_THRESHOLD,
 * ACCEPT_THRESHOLD) are handed to the LLM to decide same / new;
 * anything below is treated as no candidate.
 */
const GRAY_BAND_THRESHOLD = 0.6;

export interface IngredientMatch {
    originalName: string;
    ingredientId: string;
    matchType: "exact_name" | "alias" | "vector" | "created";
    confidence?: number;
}

/**
 * Matches ingredient names using a 4-step fallback strategy:
 * 1. Direct name match on ingredients table
 * 2. Alias match on ingredient_aliases table
 * 3. Vector search using embeddings (similarity threshold: 0.85)
 * 4. Create new ingredient if no match found
 *
 * @param names Array of ingredient names to match
 * @returns Result containing array of ingredient matches
 */
export async function matchIngredients(
    names: string[]
): Promise<Result<IngredientMatch[], PersistenceError>> {
    const ingredientsRepo = new IngredientsRepository();
    const categoriesRepo = new CategoriesRepository();
    const matches: IngredientMatch[] = [];

    // Ingredient identity — must match the SQL ingredient_canonical_id, which is
    // what produced the stored canonical_id this matches against. Shared with the
    // seed scripts via toolkit so the rule exists once.
    const toCanonicalId = ingredientCanonicalId;

    // Two names are only safe to AUTO-accept (merge without asking the LLM) when
    // they are the same words in a different order/spacing — i.e. identical
    // canonical token sets. A modifier boundary (e.g. "basil" vs "thai basil",
    // "oregano" vs "dried oregano") embeds very close (shared head noun) and would
    // otherwise clear the similarity threshold and silently collapse a genuine
    // distinction (variety, fresh/dried). Different token sets must go to the LLM,
    // which correctly rules variety/state as a distinct ingredient.
    const sameTokenSet = (a: string, b: string): boolean => {
        const ta = new Set(toCanonicalId(a).split("_").filter(Boolean));
        const tb = new Set(toCanonicalId(b).split("_").filter(Boolean));
        if (ta.size !== tb.size) return false;
        for (const t of ta) if (!tb.has(t)) return false;
        return true;
    };

    // Ingredient names must not carry parenthetical qualifiers — strip any
    // "(...)" before matching so they never enter the catalog (there is no
    // comment field here, so the note is dropped).
    const cleanedNames = names
        .map((name) => splitIngredientName(name).name)
        .filter((name) => name.length > 0);

    // Create mapping from canonical ID to original name
    const canonicalToOriginal = new Map<string, string>();
    cleanedNames.forEach(name => {
        canonicalToOriginal.set(toCanonicalId(name), name);
    });

    let unmatchedCanonicalIds = Array.from(canonicalToOriginal.keys());

    try {
        // Step 1: Direct name match (batch)
        const nameMatchesResult =
            await ingredientsRepo.findByCanonicalIds(unmatchedCanonicalIds);
        if (nameMatchesResult.success === false) {
            return nameMatchesResult;
        }

        const nameMatches = nameMatchesResult.value;
        nameMatches.forEach((ingredient, canonicalId) => {
            const originalName = canonicalToOriginal.get(canonicalId);
            if (originalName) {
                matches.push({
                    originalName,
                    ingredientId: ingredient.id,
                    matchType: "exact_name",
                });
            }
        });

        unmatchedCanonicalIds = unmatchedCanonicalIds.filter((id) => !nameMatches.has(id));

        // Get original names for unmatched canonical IDs
        let unmatchedOriginalNames = unmatchedCanonicalIds
            .map(id => canonicalToOriginal.get(id))
            .filter((name): name is string => name !== undefined);

        // Step 2: Alias match (batch)
        if (unmatchedOriginalNames.length > 0) {
            const aliasMatchesResult =
                await ingredientsRepo.findByAliases(unmatchedOriginalNames);
            if (aliasMatchesResult.success === false) {
                return aliasMatchesResult;
            }

            const aliasMatches = aliasMatchesResult.value;
            aliasMatches.forEach((ingredientId, alias) => {
                matches.push({
                    originalName: alias,
                    ingredientId,
                    matchType: "alias",
                });
            });

            unmatchedOriginalNames = unmatchedOriginalNames.filter((name) => !aliasMatches.has(name));
        }

        // Step 3+4: vector match, adjudicate the gray zone, and create only
        // validated new ingredients. The name's embedding is computed once and
        // reused for the vector search, the adjudication candidate, and (on
        // create) the category match.
        //
        // - similarity >= ACCEPT_THRESHOLD → auto-accept the match.
        // - GRAY_BAND_THRESHOLD <= similarity < ACCEPT_THRESHOLD → ask the LLM
        //   whether it's the same as the candidate or a genuinely new ingredient.
        // - No candidate → necessarily new; the LLM is asked only for the
        //   category (see `adjudicateIngredient`).
        //
        // Every name reaching here ends up attached to the suggestion, one way or
        // another. Nothing is ever dropped — see the note on `adjudicateIngredient`
        // for why a junk row is the cheap error and a lost ingredient is not.
        const learnAlias = async (ingredientId: string, alias: string) => {
            const aliasResult = await ingredientsRepo.addAlias(
                ingredientId,
                alias
            );
            if (!aliasResult.success) {
                console.error(
                    `Failed to learn alias "${alias}":`,
                    aliasResult.error
                );
            }
        };

        // Batch-embed all unmatched names in one call (text-embedding-3-small)
        // instead of a round-trip per name. Each embedding is reused for the
        // vector search, the category match, and storage.
        const embeddingByName = new Map<string, number[]>();
        if (unmatchedOriginalNames.length > 0) {
            try {
                const batch = await generateBatchEmbeddings(
                    unmatchedOriginalNames,
                    { model: "text-embedding-3-small", dimensions: 1536 }
                );
                unmatchedOriginalNames.forEach((n, i) =>
                    embeddingByName.set(n, batch.embeddings[i])
                );
            } catch (error) {
                console.error("Failed to batch-embed ingredient names:", error);
                return failure(
                    new PersistenceError(
                        `Failed to embed ingredient names: ${error instanceof Error ? error.message : "Unknown error"}`
                    )
                );
            }
        }

        // Decision phase (PARALLEL, read-only): per unmatched name, vector search
        // + LLM adjudication. This is the expensive part — the LLM adjudications
        // used to run one ingredient at a time; run them concurrently.
        type Resolution =
            | { kind: "accept"; name: string; ingredientId: string; similarity: number }
            | { kind: "create"; name: string; embedding: number[]; category?: string }
            | { kind: "skip"; name: string };

        const resolutions = await Promise.all(
            unmatchedOriginalNames.map(async (name): Promise<Resolution> => {
                const embedding = embeddingByName.get(name);
                if (!embedding) return { kind: "skip", name };

                const vectorMatchResult = await ingredientsRepo.vectorSearch(
                    embedding,
                    GRAY_BAND_THRESHOLD
                );
                if (vectorMatchResult.success === false) {
                    console.error(
                        `Vector search failed for "${name}":`,
                        vectorMatchResult.error
                    );
                }
                const candidate = vectorMatchResult.success
                    ? vectorMatchResult.value
                    : null;

                // High-confidence auto-accept — no LLM needed — but ONLY when the
                // names are the same words (identical token set). A modifier
                // boundary (variety/state, e.g. "thai basil" vs "basil") can clear
                // the similarity threshold too, so those are sent to the LLM
                // instead of being silently merged.
                if (
                    candidate &&
                    candidate.similarity >= ACCEPT_THRESHOLD &&
                    sameTokenSet(name, candidate.ingredient.name)
                ) {
                    return {
                        kind: "accept",
                        name,
                        ingredientId: candidate.ingredient.id,
                        similarity: candidate.similarity,
                    };
                }

                // Gray band or no candidate: let the LLM adjudicate.
                const adjudication = await adjudicateIngredient(
                    name,
                    candidate?.ingredient.name
                );
                if (adjudication.decision === "same" && candidate) {
                    return {
                        kind: "accept",
                        name,
                        ingredientId: candidate.ingredient.id,
                        similarity: candidate.similarity,
                    };
                }
                return {
                    kind: "create",
                    name,
                    embedding,
                    category: adjudication.category,
                };
            })
        );

        // Apply phase (SERIAL): the writes (alias learning, ingredient creation)
        // run in order — keeps create error semantics and avoids intra-suggestion
        // insert races on the ingredient canonical_id unique constraint.
        const createdIngredientIds: string[] = [];

        for (const r of resolutions) {
            if (r.kind === "skip") continue;

            if (r.kind === "accept") {
                matches.push({
                    originalName: r.name,
                    ingredientId: r.ingredientId,
                    matchType: "vector",
                    confidence: r.similarity,
                });
                await learnAlias(r.ingredientId, r.name);
                continue;
            }

            // create: prefer the LLM-chosen controlled category; fall back to
            // nearest-centroid only if it can't be resolved.
            try {
                const canonicalId = toCanonicalId(r.name);

                let categoryId: string | undefined;
                if (r.category) {
                    // r.category is already a category canonical_id (one of the
                    // controlled INGREDIENT_CATEGORIES) — look it up directly.
                    // Do NOT run it through toCanonicalId: that singularizes and
                    // would turn e.g. "herbs_spices" into "herbs_spice".
                    const catResult = await categoriesRepo.findByCanonicalId(
                        r.category
                    );
                    if (catResult.success && catResult.value) {
                        categoryId = catResult.value.id;
                        console.log(
                            `[Ingredients] Assigned "${r.name}" to category "${catResult.value.name}" (adjudicated)`
                        );
                    }
                }

                if (!categoryId) {
                    // Fallback: nearest-centroid (always returns a match).
                    const categoryMatch = await categoriesRepo.findBestMatch(
                        r.embedding
                    );
                    if (!categoryMatch.success) {
                        console.error(
                            `Failed to find category for "${r.name}":`,
                            categoryMatch.error
                        );
                        return failure(categoryMatch.error);
                    }
                    categoryId = categoryMatch.value.category.id;
                    console.log(
                        `[Ingredients] Assigned "${r.name}" to category "${categoryMatch.value.category.name}" (centroid fallback, similarity: ${categoryMatch.value.similarity.toFixed(3)})`
                    );
                }

                const createResult = await ingredientsRepo.create({
                    name: r.name,
                    canonical_id: canonicalId,
                    category_id: categoryId,
                    embedding: JSON.stringify(r.embedding),
                });

                if (createResult.success === false) {
                    console.error(
                        `Failed to create ingredient "${r.name}":`,
                        createResult.error
                    );
                    return failure(
                        new PersistenceError(
                            `Failed to create ingredient "${r.name}": ${createResult.error.message}`
                        )
                    );
                }

                matches.push({
                    originalName: r.name,
                    ingredientId: createResult.value.id,
                    matchType: "created",
                });
                createdIngredientIds.push(createResult.value.id);
            } catch (error) {
                console.error(`Failed to create ingredient "${r.name}":`, error);
                return failure(
                    new PersistenceError(
                        `Failed to create ingredient "${r.name}": ${error instanceof Error ? error.message : "Unknown error"}`
                    )
                );
            }
        }

        // Dietary classification for whatever was just invented, in ONE call for
        // the whole set rather than one per ingredient.
        //
        // Deliberately not awaited: this sits inside suggestion persistence,
        // behind a provisional card the client has already drawn, and a `gpt-4o`
        // round trip here would be latency the reader pays for a fact they are
        // not looking at yet. Nothing downstream in THIS request reads the
        // properties — they are what the dietary filters and the cards' dietary
        // chips consult on later reads — and an ingredient that never gets
        // classified is merely invisible to those filters, not wrong. See
        // `classifyNewIngredients` for why it cannot reject.
        if (createdIngredientIds.length > 0) {
            trackBackgroundTask(classifyNewIngredients(createdIngredientIds));
        }

        return success(matches);
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to match ingredients: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
