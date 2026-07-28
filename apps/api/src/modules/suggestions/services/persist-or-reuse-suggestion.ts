import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
} from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { findSuggestionByName } from "./find-suggestion-by-name";
import { persistSuggestion } from "./persist-suggestion";

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

    // Layer 2: fuzzy similarity match (similarity threshold: 0.95) to catch
    // near-duplicate spellings the exact match can't.
    const searchResult = await suggestionsRepo.searchSimilar(
        suggestion.name,
        0.95,
        1
    );

    if (!searchResult.success) {
        console.error(
            `[Suggestions] Failed to search similar suggestions for "${suggestion.name}":`,
            searchResult.error
        );
        // Continue with persistence if search fails
    } else if (searchResult.value.length > 0) {
        // Similar suggestion exists, fetch enriched data and reuse it
        const existingSuggestion = searchResult.value[0];
        console.log(
            `[Suggestions] Found similar suggestion: ${existingSuggestion.name} (score: ${existingSuggestion.score.toFixed(3)}) - reusing instead of creating duplicate`
        );

        const enrichedResult = await fetchEnrichedSuggestion(
            existingSuggestion.id
        );

        if (enrichedResult.success) {
            return enrichedResult.value;
        }

        console.error(
            `[Suggestions] Failed to fetch enriched suggestion ${existingSuggestion.id}:`,
            enrichedResult.error
        );
        // Fall through to create a new suggestion
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
