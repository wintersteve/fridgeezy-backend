import { supabaseAdmin } from "@fridgeezy/supabase";

import { searchRecipes } from "../../recipes/services/search-recipes";

/**
 * Deliberately loose — this is a recall net, not an identity test. Anything it
 * over-fetches costs a few prompt tokens; anything it misses is still caught by
 * the hard dedup guard in `persistOrReuseSuggestion`.
 */
const CATALOG_MATCH_THRESHOLD = 0.35;
const CATALOG_MATCH_LIMIT = 25;

/**
 * Catalogue size at which naming every dish stops being the better trade.
 *
 * Measured at ~3.4 prompt tokens per dish name, so 300 is roughly 1k tokens —
 * cheap against the cost of the model spending a slot on a dish the user
 * already has. Above this the vector search earns its latency back.
 */
const FULL_LIST_MAX = 300;

/**
 * How long the full catalogue list is reused for.
 *
 * Safe to cache at all because, unlike the vector search, this list does not
 * depend on the query. Stale by up to a minute only means a brand-new recipe is
 * briefly absent from the exclusions — the dedup guard still catches it, which
 * is exactly the fallback this whole function is an optimisation over.
 */
const CACHE_TTL_MS = 60_000;

let cache: { names: string[]; at: number } | null = null;

/**
 * Every dish name in the catalogue, or `null` if there are too many to name.
 *
 * Fetches one past the limit so a single query answers both "what are they" and
 * "are there too many", rather than paying for a separate count.
 */
async function allCatalogDishes(): Promise<string[] | null> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.names;
    }

    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("name")
        .limit(FULL_LIST_MAX + 1);

    if (error || !data) {
        console.error("[Suggestions] Catalog name fetch failed:", error);
        return null;
    }

    if (data.length > FULL_LIST_MAX) {
        return null;
    }

    const names = data.map((row) => row.name).filter(Boolean);
    cache = { names, at: Date.now() };

    return names;
}

/**
 * The dishes already in the recipe catalog that the generator should not propose
 * again.
 *
 * Stopping a duplicate AFTER generation (the dedup guard) is correct but
 * wasteful: the model burned a slot on a dish the user already has, and the
 * batch comes back one card short. Naming them up front lets it spend that slot
 * on something new instead.
 *
 * **While the catalogue is small, every dish is named.** This used to always be
 * a vector search, scoped so it would keep working as the catalogue grew — the
 * right instinct at scale, but measured against a 42-recipe catalogue it was
 * both slower (0.60s vs 0.34s, and it blocks the model call) and far less
 * complete: at threshold 0.35 it returned **3 of 42** dishes, so the model was
 * told about a fourteenth of what the user already had and kept proposing
 * duplicates that were withdrawn after generation.
 *
 * Above {@link FULL_LIST_MAX} the vector search takes over again, which is what
 * keeps this honest as the catalogue grows.
 *
 * Never throws: an empty list just means no exclusions this turn.
 */
export async function listCatalogDishes(query: string): Promise<string[]> {
    if (!query.trim()) {
        return [];
    }

    try {
        const all = await allCatalogDishes();

        if (all) {
            return all;
        }

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
