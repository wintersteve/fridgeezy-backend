import { generateEmbedding } from "@fridgeezy/openai";
import {
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
} from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { adjudicateSameDish } from "./adjudicate-suggestion";
import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { findRecipeForDish } from "./find-recipe-for-dish";
import { findSuggestionByName } from "./find-suggestion-by-name";
import { persistSuggestion } from "./persist-suggestion";
import { identityKey, type SuggestionBatch } from "./suggestion-batch";
import type { SuggestionOutcome } from "./suggestion-outcome";
import {
    buildSuggestionSignature,
    describeSuggestion,
    SIGNATURE_HIGH_THRESHOLD,
    SIGNATURE_LOW_THRESHOLD,
} from "./suggestion-signature";
import { verifySuggestionAuthenticity } from "./verify-suggestion-authenticity";

export type { SuggestionOutcome } from "./suggestion-outcome";

export interface PersistOrReuseOptions {
    /**
     * Coordinates dedup between the suggestions of ONE request. Omitted by the
     * single-suggestion endpoint, which has no siblings.
     */
    batch?: SuggestionBatch;
    suggestionsRepo?: SuggestionsRepository;
}

/**
 * Turn one validated LLM suggestion into an enriched (id + {id,name} chips)
 * suggestion, reusing an existing row instead of inserting a duplicate.
 *
 * The pipeline runs in the order it does because each step makes the next one
 * cheaper or more accurate:
 *
 * 1. **Review** — authenticity + canonical name, one LLM call (they are the same
 *    call because they want the same evidence; see `verifySuggestionAuthenticity`).
 * 2. **Batch dedup** — free, in memory, against the siblings of this same request.
 * 3. **Database dedup** — recipes first, then suggestions by name, then by
 *    signature.
 * 4. **Persist.**
 *
 * **Review moved to the front, and that is the change that makes dedup work.**
 * It used to be kicked off in parallel and awaited at the END, so every layer
 * below it compared the name the *generator* happened to pick. That is exactly
 * how the dev catalog ended up holding `Tarte Tatin` and `Apple Tarte Tatin`
 * (signature cosine 0.856, inside the gray band, adjudicated apart) alongside
 * `Pajeon` and `Haemul Pajeon`: canonicalise first and both pairs collapse on an
 * exact name match, for free, before a vector is ever compared.
 *
 * The cost of the reorder is that the review no longer overlaps the dedup
 * searches — roughly +0.5s, entirely behind the placeholder the client is
 * already showing. It buys back more than it spends:
 *
 * - An unauthentic dish now costs ONE call, not a call plus an embedding plus
 *   three round trips it was going to throw away.
 * - A renamed dish embeds ONCE. The old order embedded under the generator's
 *   name, discovered the rename, and embedded again.
 * - The post-rename name re-check is gone; the single name lookup below is
 *   already made under the final name.
 *
 * Dedup then runs against BOTH halves of the catalog, because a dish lives in
 * `recipe_suggestions` only until it is promoted — at which point the suggestion
 * row is deleted and the dish exists solely as a recipe:
 *
 * 1. `recipes` first, by exact name then signature similarity (see
 *    `findRecipeForDish`) — the catalog is authoritative, and a promoted dish is
 *    otherwise invisible to dedup and gets regenerated forever.
 * 2. Exact canonical-name lookup in `recipe_suggestions` — the same key the DB's
 *    unique constraint uses, so it never lets a same-name duplicate through.
 * 3. Signature similarity over `recipe_suggestions`, folding in near-duplicate
 *    spellings via the calibrated band + LLM adjudication.
 *
 * A persist that still collides (a concurrent insert of the same name from
 * another request) falls back to reusing the row that won the race rather than
 * failing the turn.
 *
 * Shared by the multi-suggestion JSONL stream and the single-suggestion field
 * stream so both dedup/persist identically.
 */
export async function persistOrReuseSuggestion(
    suggestion: GenerateSuggestionResponseDto,
    request: Pick<GenerateSuggestionRequestDto, "cuisine">,
    options: PersistOrReuseOptions = {}
): Promise<SuggestionOutcome> {
    const { batch, suggestionsRepo = new SuggestionsRepository() } = options;
    const slot = batch?.open();
    let settled = false;

    /** Publish the outcome for later siblings, and hand it to our caller. */
    const settle = (outcome: SuggestionOutcome): SuggestionOutcome => {
        settled = true;
        slot?.settle(outcome);
        return outcome;
    };

    try {
        // Step 1: is this a real dish, and what is it actually called? Keeps
        // inventions and hallucinations out of the discovery catalog, and gives
        // every layer below one stable name to key on.
        const review = await verifySuggestionAuthenticity(suggestion);

        if (!review.authentic) {
            if (review.status === "not_food") {
                // Not a quality failure — the request asked for something this
                // catalog does not hold. Reported separately so the caller can
                // stop asking rather than burn a top-up pass on it.
                console.warn(
                    `[Suggestions] Dropping "${suggestion.name}" — a drink, not a dish (out of scope for a food catalog)`
                );
                return settle({ kind: "dropped", reason: "not_food" });
            }

            console.warn(
                review.status === "adaptation"
                    ? `[Suggestions] Dropping "${suggestion.name}" — a defining ingredient is missing, so this is not that dish (ingredients: ${suggestion.ingredients.join(", ")})`
                    : review.status === "obscure"
                      ? `[Suggestions] Dropping "${suggestion.name}" — not established under any name (this cuisine may be saturated; see ATTESTED in verify-suggestion-authenticity)`
                      : `[Suggestions] Dropping "${suggestion.name}" (${review.status}, not known well enough for discovery)`
            );
            return settle({ kind: "dropped", reason: "unauthentic" });
        }

        const dish = review.name
            ? { ...suggestion, name: review.name, name_alt: review.nameAlt }
            : suggestion;

        // Embed the dish SIGNATURE (canonical name + tags + ingredients) once,
        // under the FINAL name: both halves of the catalog and every sibling are
        // compared with this same vector, so the same dish under different names
        // merges (Som Tam ≡ Green Papaya Salad) while genuine variations stay
        // apart on their differing ingredients.
        const signatureEmbedding = await generateEmbedding(
            buildSuggestionSignature({
                name: dish.name,
                tags: dish.tags,
                ingredients: dish.ingredients,
            })
        );

        const describe = describeSuggestion(
            dish.name,
            dish.name_alt,
            dish.tags,
            dish.ingredients
        );

        // Step 2: the siblings of this same request. They are not in the
        // database yet — that is the entire point — so no query below can see
        // them and this has to happen in memory.
        if (slot) {
            const identity = {
                key: identityKey(dish.name),
                name: dish.name,
                describe,
                embedding: signatureEmbedding,
            };

            slot.identify(identity);

            const duplicate = await slot.findEarlierDuplicate(identity);

            if (duplicate) {
                // Settle with the ORIGINAL's outcome, not with the withdrawal:
                // a third sibling matching this one should chain through to the
                // real row rather than be told the dish went nowhere.
                settled = true;
                slot.settle(duplicate);

                return { kind: "dropped", reason: "duplicate" };
            }
        }

        // Step 3, layer 1: the RECIPES table wins, and is therefore checked
        // FIRST. A dish that has been promoted exists as a recipe while a stale
        // suggestion row for it may ALSO still be lying around; checking
        // suggestions first would keep handing that stale row back forever and
        // the user would keep being offered a dish they already have.
        const existingRecipe = await findRecipeForDish(
            {
                name: dish.name,
                nameEn: dish.name_alt,
                tags: dish.tags,
                ingredients: dish.ingredients,
            },
            signatureEmbedding
        );

        if (existingRecipe) {
            return settle({ kind: "existing_recipe", recipe: existingRecipe });
        }

        // Layer 2: exact canonical-name match among suggestions (deterministic —
        // mirrors the DB's canonical_id unique constraint, so an already-persisted
        // dish is always reused instead of triggering a duplicate-key error).
        const exactMatch = await findSuggestionByName(dish.name);
        if (exactMatch) {
            return settle({
                kind: "suggestion",
                suggestion: exactMatch,
                reused: true,
            });
        }

        // Layer 3: signature-based semantic dedup over suggestions. Recall nearest
        // candidates, auto-merge the high-confidence ones, keep the far ones
        // distinct, and let the LLM adjudicate the gray band in between.
        const searchResult = await suggestionsRepo.searchSimilar(
            signatureEmbedding,
            SIGNATURE_LOW_THRESHOLD,
            5
        );

        if (!searchResult.success) {
            console.error(
                `[Suggestions] Failed to search similar suggestions for "${dish.name}":`,
                searchResult.error
            );
            // Continue with persistence if search fails.
        } else {
            // Candidates come back ordered by score descending.
            for (const candidate of searchResult.value) {
                if (candidate.score < SIGNATURE_LOW_THRESHOLD) break;

                const enrichedResult = await fetchEnrichedSuggestion(candidate.id);
                if (!enrichedResult.success) {
                    console.error(
                        `[Suggestions] Failed to fetch candidate ${candidate.id}:`,
                        enrichedResult.error
                    );
                    continue;
                }
                const existing = enrichedResult.value;

                const autoMerge = candidate.score >= SIGNATURE_HIGH_THRESHOLD;
                const isSameDish =
                    autoMerge ||
                    (await adjudicateSameDish(
                        describe,
                        describeSuggestion(
                            existing.name,
                            existing.nameEn,
                            existing.tags.map((t) => t.name),
                            existing.ingredients.map((i) => i.name)
                        )
                    ));

                if (isSameDish) {
                    console.log(
                        `[Suggestions] Reusing "${existing.name}" for "${dish.name}" (score ${candidate.score.toFixed(3)}${autoMerge ? "" : ", adjudicated"})`
                    );
                    return settle({
                        kind: "suggestion",
                        suggestion: existing,
                        reused: true,
                    });
                }
            }
        }

        // Step 4: persist. The signature embedding is the one computed above —
        // built from the final name, so nothing has to be re-embedded.
        const persistResult = await persistSuggestion(dish, {
            cuisineTag: request.cuisine,
            nameEn: dish.name_alt,
            signatureEmbedding,
        });

        if (!persistResult.success) {
            // A concurrent request may have inserted the same canonical_id
            // between our layer-2 check and this insert (duplicate-key). Reuse
            // the row that won the race rather than failing the turn.
            const raced = await findSuggestionByName(dish.name);
            if (raced) {
                return settle({
                    kind: "suggestion",
                    suggestion: raced,
                    reused: true,
                });
            }

            console.error(
                `[Suggestions] Failed to persist: ${dish.name}`,
                persistResult.error
            );
            return settle({ kind: "dropped", reason: "persist_failed" });
        }

        return settle({
            kind: "suggestion",
            suggestion: {
                id: persistResult.value.suggestionId,
                name: dish.name,
                nameEn: dish.name_alt,
                description: dish.description,
                difficulty: dish.difficulty,
                ingredients: persistResult.value.ingredients,
                tags: persistResult.value.tags,
            },
        });
    } finally {
        // A throw must still release any sibling waiting on this slot, or the
        // batch stalls until the request times out.
        if (!settled) slot?.abandon();
    }
}
