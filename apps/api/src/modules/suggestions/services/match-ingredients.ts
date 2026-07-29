import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { CategoriesRepository, IngredientsRepository } from "@fridgeezy/supabase";
import { splitIngredientName } from "@fridgeezy/toolkit";

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
 * ACCEPT_THRESHOLD) are handed to the LLM to decide same / new / invalid;
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

    // Helper function to convert name to canonical ID
    const toCanonicalId = (name: string): string =>
        name.toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

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
        // - GRAY_BAND_THRESHOLD <= similarity < ACCEPT_THRESHOLD, or no candidate
        //   → ask the LLM whether it's the same as the candidate, a genuinely new
        //   ingredient, or not a real ingredient. Only real new ones are created;
        //   junk is dropped rather than polluting the catalog.
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
            | { kind: "invalid"; name: string }
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

                // High-confidence auto-accept — no LLM needed.
                if (candidate && candidate.similarity >= ACCEPT_THRESHOLD) {
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
                if (adjudication.decision === "invalid") {
                    return { kind: "invalid", name };
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

            if (r.kind === "invalid") {
                console.warn(
                    `[Ingredients] Skipping "${r.name}" — adjudged not a real ingredient`
                );
                continue;
            }

            // create: prefer the LLM-chosen controlled category; fall back to
            // nearest-centroid only if it can't be resolved.
            try {
                const canonicalId = toCanonicalId(r.name);

                let categoryId: string | undefined;
                if (r.category) {
                    const catResult = await categoriesRepo.findByCanonicalId(
                        toCanonicalId(r.category)
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
            } catch (error) {
                console.error(`Failed to create ingredient "${r.name}":`, error);
                return failure(
                    new PersistenceError(
                        `Failed to create ingredient "${r.name}": ${error instanceof Error ? error.message : "Unknown error"}`
                    )
                );
            }
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
