import { generateEmbedding } from "@fridgeezy/openai";
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
    // Embed the query app-side (text-embedding-3-small) and pass the vector to
    // search_recipes — no OpenAI call from Postgres.
    const embedding = await generateEmbedding(query);

    return searchRecipesByEmbedding(embedding, threshold, limit);
}

/**
 * Same search against a PRECOMPUTED query embedding. Used by dedup, which has
 * already embedded the dish signature and must not pay for a second embedding
 * (and must compare against the exact same vector it deduped suggestions with).
 *
 * @param embedding - A 1536-dim text-embedding-3-small vector
 * @param threshold - Minimum similarity score (0-1)
 * @param limit - Maximum number of results
 */
export async function searchRecipesByEmbedding(
    embedding: number[],
    threshold = 0.75,
    limit = 3
): Promise<SearchRecipeResult[]> {
    const { data, error } = await supabaseAdmin.rpc("search_recipes", {
        query_embedding: JSON.stringify(embedding),
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
