import { EnrichedSuggestionResponseDto } from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";

/**
 * Find a suggestion by exact name match and return enriched data
 *
 * @param name The suggestion name to search for
 * @returns Enriched suggestion or null if not found
 */
export async function findSuggestionByName(
    name: string
): Promise<EnrichedSuggestionResponseDto | null> {
    const repository = new SuggestionsRepository();

    // Search for suggestion by exact name match
    const result = await repository.findByName(name);

    if (!result.success || !result.value) {
        return null;
    }

    // Fetch enriched data with ingredients and tags
    const enrichedResult = await fetchEnrichedSuggestion(result.value.id);

    if (!enrichedResult.success) {
        console.error(
            `[FindSuggestion] Failed to fetch enriched data for ${name}:`,
            enrichedResult.error
        );
        return null;
    }

    return enrichedResult.value;
}
