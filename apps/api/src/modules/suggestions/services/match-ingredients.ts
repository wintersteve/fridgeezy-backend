import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { CategoriesRepository, IngredientsRepository } from "@fridgeezy/supabase";
import {
    ingredientCanonicalId,
    isAdjudicableCandidate,
    splitIngredientName,
} from "@fridgeezy/toolkit";

import { trackBackgroundTask } from "../../../background-tasks";
import {
    classifyNewIngredientComponents,
    classifyNewIngredients,
} from "../../ingredients/services";

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
/**
 * How many nearest neighbours to retrieve before filtering.
 *
 * This was 1, and that is what let duplicates through: name embeddings are
 * lexical, so rank 1 is systematically a SIBLING sharing the head noun while
 * the actual synonym sits further down. Measured live — "Green Onion" returns
 * White Onion (0.802) first with Scallion at 0.681; "Soya Sauce" returns Sweet
 * Soy Sauce (0.871) first with plain Soy Sauce third. The adjudicator was
 * always asked about the wrong row.
 *
 * 10 is enough to reach the synonym in every fragmented pair measured (worst
 * observed rank: 3). It costs no extra LLM call — the shortlist goes in ONE
 * prompt — and one extra round trip's worth of rows.
 */
const CANDIDATE_LIMIT = 10;
/**
 * How many survivors of the structural filter are actually offered.
 *
 * Bounded because the prompt is a list the model has to hold in one judgement,
 * and a long tail of 0.6-similarity strangers is noise that makes a spurious
 * "same" more likely, not less.
 */
const SHORTLIST_LIMIT = 5;

export interface IngredientMatch {
    originalName: string;
    ingredientId: string;
    matchType: "exact_name" | "alias" | "vector" | "created";
    confidence?: number;
}

/**
 * Matches ingredient names using a 4-step fallback strategy:
 * 1. Direct canonical-id match on ingredients table
 * 2. Alias match on ingredient_aliases, by CANONICAL id (not the literal name)
 * 3. Vector search for the 10 nearest, siblings withheld, remainder adjudicated
 *    as one shortlist in a single LLM call
 * 4. Create new ingredient if no match found
 *
 * Steps 2 and 3 both changed in 20260823000003. They were each losing a synonym
 * for an independent reason — a case-sensitive alias comparison, and a
 * single-candidate retrieval that returns siblings ahead of synonyms — and
 * between them they are why `Scallion`, `Green Onion` and `Spring Onion` are
 * three rows. See `INGREDIENT_IDENTITY.md`.
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

        // Step 2: Alias match (batch), keyed on the CANONICAL form.
        //
        // This lookup used to compare the raw name against the stored `alias`
        // literally, and PostgREST `.in()` is case-sensitive: Title-Case model
        // output ("Green Onion") never matched a lowercase stored alias
        // ("green onion"), so this step fell through on essentially every name
        // while the table held the right answer. That is how a duplicate
        // `Green Onion` row came to exist alongside `green onion -> Scallion`.
        if (unmatchedOriginalNames.length > 0) {
            const canonicalByName = new Map(
                unmatchedOriginalNames.map((name) => [name, toCanonicalId(name)])
            );

            const aliasMatchesResult =
                await ingredientsRepo.findByAliasCanonicalIds([
                    ...new Set(canonicalByName.values()),
                ]);

            // FAIL SOFT. This step is a lookup OPTIMISATION — a miss simply
            // falls through to vector search and adjudication, which is the same
            // thing that happens for any name with no alias. So a failure here
            // must cost recall, never the recipe.
            //
            // It used to `return` the failure, which aborted `matchIngredients`
            // and with it the entire persist. That turned a missing column into
            // "failed to persist" on every save — and it is the one query in
            // this function with a SCHEMA dependency (`alias_canonical_id`,
            // added in 20260823000003), so it is precisely the query most likely
            // to fail on a database that is a migration behind. Code shipping
            // ahead of its migration is an ordering mistake; taking recipe
            // saving down when it happens is a design one, and only the second
            // is fixable here.
            //
            // Matches how the vector step below already behaves.
            if (aliasMatchesResult.success === false) {
                console.error(
                    "[Ingredients] alias lookup failed — continuing without it:",
                    aliasMatchesResult.error
                );
            }

            const aliasMatches = aliasMatchesResult.success
                ? aliasMatchesResult.value
                : new Map();
            const resolvedByAlias = new Set<string>();

            unmatchedOriginalNames.forEach((name) => {
                const target = aliasMatches.get(canonicalByName.get(name) ?? "");
                if (!target) return;

                // NO structural interlock here, and that is a measured decision
                // rather than an oversight — the interlock belongs on the vector
                // path, which GUESSES, not on this one, which reads an explicit
                // assertion that two names are the same thing.
                //
                // The worry was real: fixing the comparison above activates
                // aliases that have been inert, and one of them is wrong
                // (`red bell pepper -> Green Bell Pepper`, learned at runtime by
                // the old single-candidate adjudicator). But applying the
                // sibling rule here withholds 58 of 238 aliases, and they are
                // overwhelmingly legitimate: `chilli powder -> Chili Powder`,
                // `minced beef -> Ground Beef`, `icing sugar -> Powdered Sugar`,
                // `wholemeal flour -> Whole Wheat Flour`. Those are spelling and
                // regional variants that happen to share a head noun, and
                // withholding them re-opens the very leak this change closes.
                //
                // The wrong alias cannot fire anyway: 94 aliases — that one
                // included — have an ingredient row of their own canonical id,
                // and step 1 resolves canonical BEFORE this step is reached. An
                // alias contradicting an existing row is unreachable by
                // construction, which is exactly the class
                // `ingredient_alias_collisions` reports for human review.
                matches.push({
                    originalName: name,
                    ingredientId: target.id,
                    matchType: "alias",
                });
                resolvedByAlias.add(name);
            });

            unmatchedOriginalNames = unmatchedOriginalNames.filter(
                (name) => !resolvedByAlias.has(name)
            );
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
        const learnAlias = async (
            ingredientId: string,
            alias: string,
            targetName: string
        ) => {
            // Never LEARN a sibling-shaped alias. This is where the table's own
            // errors come from: the single wrong alias in the catalogue
            // (`red bell pepper -> Green Bell Pepper`) was written here, at
            // runtime, by an adjudicator that accepted a bad match — and a
            // learned alias is permanent and trusted by every later lookup.
            //
            // The vector path already withholds siblings from adjudication, so
            // in normal operation this cannot trigger; it stands as a floor
            // under the auto-accept branch and any future caller.
            if (!isAdjudicableCandidate(alias, targetName)) {
                console.warn(
                    `[Ingredients] refusing to learn "${alias}" -> "${targetName}": sibling-shaped`
                );
                return;
            }

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
            | {
                  kind: "accept";
                  name: string;
                  ingredientId: string;
                  ingredientName: string;
                  similarity: number;
              }
            | { kind: "create"; name: string; embedding: number[]; category?: string }
            | { kind: "skip"; name: string };

        const resolutions = await Promise.all(
            unmatchedOriginalNames.map(async (name): Promise<Resolution> => {
                const embedding = embeddingByName.get(name);
                if (!embedding) return { kind: "skip", name };

                const vectorMatchResult = await ingredientsRepo.vectorSearchMany(
                    embedding,
                    GRAY_BAND_THRESHOLD,
                    CANDIDATE_LIMIT
                );
                if (vectorMatchResult.success === false) {
                    console.error(
                        `Vector search failed for "${name}":`,
                        vectorMatchResult.error
                    );
                }
                const candidates = vectorMatchResult.success
                    ? vectorMatchResult.value
                    : [];
                const nearest = candidates[0] ?? null;

                // High-confidence auto-accept — no LLM needed — but ONLY when the
                // names are the same words (identical token set). A modifier
                // boundary (variety/state, e.g. "thai basil" vs "basil") can clear
                // the similarity threshold too, so those are sent to the LLM
                // instead of being silently merged.
                //
                // Still evaluated against the NEAREST candidate only: this is the
                // "these are the same words rearranged" case, and if the closest
                // row is not that, no further-away row is either.
                if (
                    nearest &&
                    nearest.similarity >= ACCEPT_THRESHOLD &&
                    sameTokenSet(name, nearest.ingredient.name)
                ) {
                    return {
                        kind: "accept",
                        name,
                        ingredientId: nearest.ingredient.id,
                        ingredientName: nearest.ingredient.name,
                        similarity: nearest.similarity,
                    };
                }

                // THE STRUCTURAL INTERLOCK. Withhold siblings — same head noun,
                // both sides modified ("rice flour" vs "all purpose flour",
                // "duck egg" vs "chicken egg"). Widening retrieval surfaces more
                // of these than it does synonyms, because a shared head noun is
                // exactly what drives the embedding score, so without this filter
                // the wider net is a new way to merge Rice Flour into Flour
                // rather than a way to find Scallion.
                //
                // A withheld sibling is not adjudicated as "different" — it is
                // never asked about at all. That is deliberate: the pair may
                // genuinely be one ingredient (Green Onion / Spring Onion is
                // structurally identical to Chicken Egg / Duck Egg), and those
                // cases are meant to surface as review rows rather than be
                // decided here. See `ingredientRelation` in @fridgeezy/toolkit.
                const shortlist = candidates
                    .filter((candidate) =>
                        isAdjudicableCandidate(name, candidate.ingredient.name)
                    )
                    .slice(0, SHORTLIST_LIMIT);

                if (candidates.length > 0 && shortlist.length === 0) {
                    console.log(
                        `[Ingredients] "${name}" — all ${candidates.length} candidate(s) withheld as siblings; creating`
                    );
                }

                // Gray band or no candidate: let the LLM adjudicate the whole
                // shortlist in ONE call and name which candidate, if any.
                const adjudication = await adjudicateIngredient(
                    name,
                    shortlist.map((candidate) => candidate.ingredient.name)
                );
                if (
                    adjudication.decision === "same" &&
                    adjudication.matchIndex !== undefined
                ) {
                    const chosen = shortlist[adjudication.matchIndex];
                    console.log(
                        `[Ingredients] "${name}" -> "${chosen.ingredient.name}" (adjudicated from ${shortlist.length} candidate(s), similarity ${chosen.similarity.toFixed(3)})`
                    );
                    return {
                        kind: "accept",
                        name,
                        ingredientId: chosen.ingredient.id,
                        ingredientName: chosen.ingredient.name,
                        similarity: chosen.similarity,
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
                await learnAlias(r.ingredientId, r.name, r.ingredientName);
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
        //
        // The component classification rides along for the same reasons and with
        // the same guarantees. It is a SECOND call rather than a widening of the
        // first: the two prompts are long, carefully tuned and about unrelated
        // questions, and merging them would let a change to one degrade the
        // other. Both are paid once per ingredient, never per request.
        if (createdIngredientIds.length > 0) {
            trackBackgroundTask(classifyNewIngredients(createdIngredientIds));
            trackBackgroundTask(
                classifyNewIngredientComponents(createdIngredientIds)
            );
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
