import { EnrichedSuggestionResponseDto } from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { pickIdentityMatch } from "./pick-identity-match";

/**
 * The suggestion stored under this exact canonical name AND compatible cuisine,
 * enriched, or null.
 *
 * One name can now carry several rows — identity is
 * `(canonical_id, identity_cuisine)` — so this looks all of them up and lets
 * `pickIdentityMatch` decide. A name hit whose cuisine is disjoint from every
 * candidate returns null on purpose: that is the homograph case, and the caller
 * must fall through to the signature layer rather than answer from the name.
 *
 * Enrichment is deliberately LAZY. The previous version fetched the enriched row
 * before deciding anything, which with 0..N candidates would be N round trips
 * for a decision that needs none of them — the cuisine is already on each row.
 *
 * @param name The dish name to look up
 * @param cuisine The dish's identity cuisine, or null when unknown (which merges)
 */
export async function findSuggestionByName(
    name: string,
    cuisine: string | null = null
): Promise<EnrichedSuggestionResponseDto | null> {
    const repository = new SuggestionsRepository();
    const result = await repository.findByCanonicalName(name);

    if (!result.success || result.value.length === 0) {
        return null;
    }

    const match = await pickIdentityMatch(
        { name, cuisine },
        result.value.map((row) => ({
            row,
            identityCuisine: row.identity_cuisine,
            label: row.name,
        }))
    );

    if (!match) {
        return null;
    }

    const enrichedResult = await fetchEnrichedSuggestion(match.id);

    if (!enrichedResult.success) {
        console.error(
            `[FindSuggestion] Failed to fetch enriched data for ${name}:`,
            enrichedResult.error
        );
        return null;
    }

    return enrichedResult.value;
}
