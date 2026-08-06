import { generateEmbedding } from "@fridgeezy/openai";
import { SuggestionsRepository, supabaseAdmin } from "@fridgeezy/supabase";

import { searchRecipesByEmbedding } from "../../recipes/services/search-recipes";

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
 * Measured at ~3.4 prompt tokens per dish name, so this budget is roughly 1.4k
 * tokens — about $0.003 a batch on gpt-4.1, against the cost of the model
 * spending a slot on a dish the user already has. Above this the vector search
 * earns its latency back.
 *
 * Raised from 300 when suggestions joined recipes in this list: the dev
 * catalogue is 46 recipes and 242 suggestions, so the old ceiling would have
 * tipped straight into the lossy vector path the moment both were counted.
 */
const FULL_LIST_MAX = 400;

/**
 * How long the full catalogue list is reused for.
 *
 * Safe to cache at all because, unlike the vector search, this list does not
 * depend on the query. Stale by up to a minute only means a brand-new dish is
 * briefly absent from the exclusions — the dedup guard still catches it, which
 * is exactly the fallback this whole function is an optimisation over.
 */
const CACHE_TTL_MS = 60_000;

let cache: { names: string[]; at: number } | null = null;

/**
 * Every dish name in the catalogue, or `null` if there are too many to name.
 *
 * **Both tables, not just `recipes`.** A dish exists as a suggestion long before
 * anyone promotes it — 242 suggestions against 46 recipes in the dev catalogue —
 * so listing only recipes told the generator about a sixth of what the user had
 * already been shown, and it re-proposed the rest. That is how `Arancini`,
 * `Arancini al Burro` and `Arancini di Riso al Ragù` all ended up stored: three
 * separate batches, days apart, none of which knew the earlier ones existed.
 *
 * Fetches one past the limit so a single query answers both "what are they" and
 * "are there too many", rather than paying for a separate count.
 */
async function allCatalogDishes(): Promise<string[] | null> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.names;
    }

    const [recipes, suggestions] = await Promise.all([
        supabaseAdmin.from("recipes").select("name").limit(FULL_LIST_MAX + 1),
        supabaseAdmin
            .from("recipe_suggestions")
            .select("name")
            .limit(FULL_LIST_MAX + 1),
    ]);

    if (recipes.error || !recipes.data || suggestions.error || !suggestions.data) {
        console.error(
            "[Suggestions] Catalog name fetch failed:",
            recipes.error ?? suggestions.error
        );
        return null;
    }

    const names = [...recipes.data, ...suggestions.data]
        .map((row) => row.name)
        .filter(Boolean);

    // Deduplicated case-insensitively: a promoted dish can appear in both tables
    // for a while, and paying prompt tokens to name it twice teaches the model
    // nothing.
    const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];

    if (unique.length > FULL_LIST_MAX) {
        return null;
    }

    cache = { names: unique, at: Date.now() };

    return unique;
}

/**
 * Nearest existing SUGGESTIONS to the query, for the oversized-catalogue path.
 *
 * The suggestion table has no `search_*` RPC of its own that takes a query
 * string, so the query is embedded once here and the same vector drives both
 * searches — one embedding, two lookups.
 */
async function searchCatalog(query: string): Promise<string[]> {
    const embedding = await generateEmbedding(query);

    const [recipes, suggestions] = await Promise.all([
        searchRecipesByEmbedding(
            embedding,
            CATALOG_MATCH_THRESHOLD,
            CATALOG_MATCH_LIMIT
        ),
        new SuggestionsRepository().searchSimilar(
            embedding,
            CATALOG_MATCH_THRESHOLD,
            CATALOG_MATCH_LIMIT
        ),
    ]);

    const suggestionNames = suggestions.success
        ? suggestions.value.map((match) => match.name)
        : [];

    return [...recipes.map((match) => match.name), ...suggestionNames];
}

/**
 * The dishes already in the catalog that the generator should not propose again.
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

        return await searchCatalog(query);
    } catch (error) {
        console.error("[Suggestions] Catalog exclusion lookup failed:", error);
        return [];
    }
}

/**
 * Render the exclusion list as a user-prompt block (empty when there is none).
 *
 * Deduplicated case-insensitively because the caller merges several sources —
 * the catalogue, the client's own "already on screen" list, and the dishes an
 * earlier pass of this same request already emitted.
 */
export function buildExistingDishesBlock(names: string[]): string {
    const unique = [
        ...new Map(
            names
                .map((name) => name.trim())
                .filter(Boolean)
                .map((name) => [name.toLowerCase(), name])
        ).values(),
    ];

    if (unique.length === 0) {
        return "";
    }

    return `Already in the catalog (do NOT suggest these, nor a variation, translation or spelling variant of one): ${unique.join(", ")}`;
}
