import { searchRecipes } from "../../recipes/services/search-recipes";

/**
 * Deliberately loose — this is a recall net, not an identity test. Anything it
 * over-fetches costs a few prompt tokens; anything it misses is still caught by
 * the hard dedup guard in `persistOrReuseSuggestion`.
 */
const CATALOG_MATCH_THRESHOLD = 0.35;
const CATALOG_MATCH_LIMIT = 25;

/**
 * The dishes already in the recipe catalog that are plausibly relevant to this
 * request, so the generator can be told not to propose them again.
 *
 * Stopping a duplicate AFTER generation (the dedup guard) is correct but
 * wasteful: the model burned a slot on a dish the user already has, and the
 * batch comes back one card short. Naming them up front lets it spend that slot
 * on something new instead. Vector-scoped rather than "every recipe" so it keeps
 * working as the catalog grows.
 *
 * Never throws: an empty list just means no exclusions this turn.
 */
export async function listCatalogDishes(query: string): Promise<string[]> {
    if (!query.trim()) {
        return [];
    }

    try {
        const matches = await searchRecipes(
            query,
            CATALOG_MATCH_THRESHOLD,
            CATALOG_MATCH_LIMIT
        );

        return matches.map((match) => match.name);
    } catch (error) {
        console.error("[Suggestions] Catalog exclusion lookup failed:", error);
        return [];
    }
}

/** Render the exclusion list as a user-prompt block (empty when there is none). */
export function buildExistingDishesBlock(names: string[]): string {
    if (names.length === 0) {
        return "";
    }

    return `Already in the catalog (do NOT suggest these): ${names.join(", ")}`;
}
