import { supabaseAdmin } from "@fridgeezy/supabase";

export interface SearchRecipeResult {
    id: string;
    name: string;
    score: number;
}

/**
 * Search for recipes using full-text vector search.
 * Wraps the search_recipes Supabase RPC function.
 *
 * @param query - The search query text
 * @param threshold - Minimum similarity score (0-1, default 0.75)
 * @param limit - Maximum number of results (default 3)
 * @returns Array of matching recipes with similarity scores
 */
export async function searchRecipes(
    query: string,
    threshold = 0.75,
    limit = 3
): Promise<SearchRecipeResult[]> {
    const { data, error } = await supabaseAdmin.rpc("search_recipes", {
        search_query: query,
        match_threshold: threshold,
        match_count: limit,
    });

    if (error) {
        console.error("Vector search error:", error);
        return [];
    }

    if (!data || !Array.isArray(data)) {
        return [];
    }

    return data.map((result) => ({
        id: result.id,
        name: result.name,
        score: result.score,
    }));
}
