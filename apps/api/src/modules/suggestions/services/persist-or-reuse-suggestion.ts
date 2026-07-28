import { generateEmbedding } from "@fridgeezy/openai";
import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
} from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { adjudicateSameDish } from "./adjudicate-suggestion";
import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { findSuggestionByName } from "./find-suggestion-by-name";
import { persistSuggestion } from "./persist-suggestion";
import {
    buildSuggestionSignature,
    describeSuggestion,
} from "./suggestion-signature";
import { verifySuggestionAuthenticity } from "./verify-suggestion-authenticity";

/** Signature cosine similarity at/above which two dishes auto-merge. */
const SIGNATURE_HIGH_THRESHOLD = 0.93;
/** Below this, candidates are treated as distinct dishes (no adjudication). */
const SIGNATURE_LOW_THRESHOLD = 0.8;

/**
 * Turn one validated LLM suggestion into an enriched (id + {id,name} chips)
 * suggestion, reusing an existing row instead of inserting a duplicate.
 *
 * Dedupe happens in two layers because the DB enforces uniqueness on
 * `canonical_id` (a deterministic slug of the name) while the vector search is
 * fuzzy: (1) an EXACT canonical-name lookup — the same key the unique constraint
 * uses, so it never lets a same-name duplicate through — then (2) a >=0.95
 * similarity search to fold in near-duplicate spellings. A persist that still
 * collides (a concurrent insert of the same name) falls back to reusing the row
 * that won the race rather than failing the turn.
 *
 * Shared by the multi-suggestion JSONL stream and the single-suggestion field
 * stream so both dedupe/persist identically. Returns `null` only if persistence
 * genuinely failed.
 */
export async function persistOrReuseSuggestion(
    suggestion: GenerateSuggestionResponseDto,
    request: Pick<GenerateSuggestionRequestDto, "cuisine">,
    suggestionsRepo: SuggestionsRepository = new SuggestionsRepository()
): Promise<EnrichedSuggestionResponseDto | null> {
    // Layer 1: exact canonical-name match (deterministic — mirrors the DB's
    // canonical_id unique constraint, so an already-persisted dish is always
    // reused instead of triggering a duplicate-key error on insert).
    const exactMatch = await findSuggestionByName(suggestion.name);
    if (exactMatch) {
        return exactMatch;
    }

    // Layer 2: signature-based semantic dedup. Embed the dish SIGNATURE (English
    // name + tags + ingredients) so the same dish under different names merges
    // (Som Tam ≡ Green Papaya Salad) while genuine variations stay distinct.
    // Recall nearest candidates, auto-merge the high-confidence ones, keep the
    // far ones distinct, and let the LLM adjudicate the gray band in between.
    const signatureEmbedding = await generateEmbedding(
        buildSuggestionSignature({
            name: suggestion.name,
            nameEn: suggestion.name_en,
            tags: suggestion.tags,
            ingredients: suggestion.ingredients,
        })
    );
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
                return existing;
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
        return null;
    }

    // No similar suggestion found or fetch failed, persist new suggestion
    const persistResult = await persistSuggestion(suggestion, {
        cuisineTag: request.cuisine,
        nameEn: suggestion.name_en,
    });

    if (!persistResult.success) {
        // A concurrent request may have inserted the same canonical_id between
        // our layer-1 check and this insert (duplicate-key). Reuse the row that
        // won the race rather than failing the turn.
        const raced = await findSuggestionByName(suggestion.name);
        if (raced) {
            return raced;
        }

        console.error(
            `[Suggestions] Failed to persist: ${suggestion.name}`,
            persistResult.error
        );
        return null;
    }

    return {
        id: persistResult.value.suggestionId,
        name: suggestion.name,
        nameEn: suggestion.name_en,
        description: suggestion.description,
        difficulty: suggestion.difficulty,
        ingredients: persistResult.value.ingredients,
        tags: persistResult.value.tags,
    };
}
