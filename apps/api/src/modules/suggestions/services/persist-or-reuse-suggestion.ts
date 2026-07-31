import { generateEmbedding } from "@fridgeezy/openai";
import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
} from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { RecipeSummary } from "../../recipes/services/fetch-recipe-summary";

import { adjudicateSameDish } from "./adjudicate-suggestion";
import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { findRecipeForDish } from "./find-recipe-for-dish";
import { findSuggestionByName } from "./find-suggestion-by-name";
import { persistSuggestion } from "./persist-suggestion";
import {
    buildSuggestionSignature,
    describeSuggestion,
    SIGNATURE_HIGH_THRESHOLD,
    SIGNATURE_LOW_THRESHOLD,
} from "./suggestion-signature";
import { verifySuggestionAuthenticity } from "./verify-suggestion-authenticity";

/**
 * What became of one generated suggestion.
 *
 * `existing_recipe` is not a failure — it means the dish the model proposed is
 * already in the catalog as a full recipe, so no suggestion was (or should be)
 * created for it. Callers decide what to show: the chat search surfaces the
 * recipe, the batch generator drops the card so the user is never re-offered a
 * dish they already have.
 */
export type SuggestionOutcome =
    | { kind: "suggestion"; suggestion: EnrichedSuggestionResponseDto }
    | { kind: "existing_recipe"; recipe: RecipeSummary }
    | { kind: "dropped"; reason: "unauthentic" | "persist_failed" | "invalid" };

/**
 * Turn one validated LLM suggestion into an enriched (id + {id,name} chips)
 * suggestion, reusing an existing row instead of inserting a duplicate.
 *
 * Dedup runs against BOTH halves of the catalog, because a dish lives in
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
 * A persist that still collides (a concurrent insert of the same name) falls
 * back to reusing the row that won the race rather than failing the turn.
 *
 * Shared by the multi-suggestion JSONL stream and the single-suggestion field
 * stream so both dedup/persist identically.
 */
export async function persistOrReuseSuggestion(
    suggestion: GenerateSuggestionResponseDto,
    request: Pick<GenerateSuggestionRequestDto, "cuisine">,
    suggestionsRepo: SuggestionsRepository = new SuggestionsRepository()
): Promise<SuggestionOutcome> {
    // Embed the dish SIGNATURE (English name + tags + ingredients) once, up
    // front: both halves of the catalog are searched with this same vector, so
    // the same dish under different names merges (Som Tam ≡ Green Papaya Salad)
    // while genuine variations stay apart on their differing ingredients.
    const signatureEmbedding = await generateEmbedding(
        buildSuggestionSignature({
            name: suggestion.name,
            nameEn: suggestion.name_en,
            tags: suggestion.tags,
            ingredients: suggestion.ingredients,
        })
    );

    // Layer 1: the RECIPES table wins, and is therefore checked FIRST. A dish
    // that has been promoted exists as a recipe while a stale suggestion row for
    // it may ALSO still be lying around; checking suggestions first would keep
    // handing that stale row back forever and the user would keep being offered
    // a dish they already have.
    const existingRecipe = await findRecipeForDish(
        {
            name: suggestion.name,
            nameEn: suggestion.name_en,
            tags: suggestion.tags,
            ingredients: suggestion.ingredients,
        },
        signatureEmbedding
    );

    if (existingRecipe) {
        return { kind: "existing_recipe", recipe: existingRecipe };
    }

    // Layer 2: exact canonical-name match among suggestions (deterministic —
    // mirrors the DB's canonical_id unique constraint, so an already-persisted
    // dish is always reused instead of triggering a duplicate-key error).
    const exactMatch = await findSuggestionByName(suggestion.name);
    if (exactMatch) {
        return { kind: "suggestion", suggestion: exactMatch };
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
            `[Suggestions] Failed to search similar suggestions for "${suggestion.name}":`,
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
                    describeSuggestion(
                        suggestion.name,
                        suggestion.name_en,
                        suggestion.tags,
                        suggestion.ingredients
                    ),
                    describeSuggestion(
                        existing.name,
                        existing.nameEn,
                        existing.tags.map((t) => t.name),
                        existing.ingredients.map((i) => i.name)
                    )
                ));

            if (isSameDish) {
                console.log(
                    `[Suggestions] Reusing "${existing.name}" for "${suggestion.name}" (score ${candidate.score.toFixed(3)}${autoMerge ? "" : ", adjudicated"})`
                );
                return { kind: "suggestion", suggestion: existing };
            }
        }
    }

    // Authenticity gate — only runs for genuinely new dishes (dedup already
    // returned any existing, already-vetted one). Keep inventions and
    // hallucinations out of the discovery catalog.
    const isAuthentic = await verifySuggestionAuthenticity(suggestion);
    if (!isAuthentic) {
        console.warn(
            `[Suggestions] Dropping unauthentic dish "${suggestion.name}" (not attested for discovery)`
        );
        return { kind: "dropped", reason: "unauthentic" };
    }

    // No similar suggestion found or fetch failed, persist new suggestion.
    // Reuse the signature embedding we already computed for the dedup search.
    const persistResult = await persistSuggestion(suggestion, {
        cuisineTag: request.cuisine,
        nameEn: suggestion.name_en,
        signatureEmbedding,
    });

    if (!persistResult.success) {
        // A concurrent request may have inserted the same canonical_id between
        // our layer-1 check and this insert (duplicate-key). Reuse the row that
        // won the race rather than failing the turn.
        const raced = await findSuggestionByName(suggestion.name);
        if (raced) {
            return { kind: "suggestion", suggestion: raced };
        }

        console.error(
            `[Suggestions] Failed to persist: ${suggestion.name}`,
            persistResult.error
        );
        return { kind: "dropped", reason: "persist_failed" };
    }

    return {
        kind: "suggestion",
        suggestion: {
            id: persistResult.value.suggestionId,
            name: suggestion.name,
            nameEn: suggestion.name_en,
            description: suggestion.description,
            difficulty: suggestion.difficulty,
            ingredients: persistResult.value.ingredients,
            tags: persistResult.value.tags,
        },
    };
}
