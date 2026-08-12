import { failure, NotFoundError, PersistenceError, Result, success } from "@fridgeezy/domain";
import { EnrichedSuggestionResponseDto } from "@fridgeezy/schemas";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Fetches an enriched suggestion by ID with its ingredient and tag relations
 *
 * @param id The suggestion UUID
 * @returns Result containing the enriched suggestion or an error
 */
export async function fetchEnrichedSuggestion(
    id: string
): Promise<Result<EnrichedSuggestionResponseDto, PersistenceError | NotFoundError>> {
    try {
        // Fetch suggestion with related ingredients and tags using joins
        const { data, error } = await supabaseAdmin
            .from("recipe_suggestions")
            .select(`
                id,
                name,
                name_en,
                description,
                difficulty,
                total_time_minutes,
                recipe_suggestion_ingredients(
                    ingredients(
                        id,
                        name
                    )
                ),
                recipe_suggestion_tags(
                    tags(
                        id,
                        name
                    )
                )
            `)
            .eq("id", id)
            .single();

        if (error) {
            // PGRST116 = PostgREST error code for "not found"
            if (error.code === "PGRST116") {
                return failure(new NotFoundError("RecipeSuggestion", id));
            }
            return failure(new PersistenceError(error.message));
        }

        if (!data) {
            return failure(new NotFoundError("RecipeSuggestion", id));
        }

        // Transform the joined data into EnrichedSuggestionResponseDto format
        const enriched: EnrichedSuggestionResponseDto = {
            id: data.id,
            name: data.name,
            nameEn: data.name_en ?? null,
            description: data.description || "",
            difficulty: data.difficulty as "easy" | "medium" | "hard",
            totalTimeMinutes: data.total_time_minutes ?? null,
            ingredients: data.recipe_suggestion_ingredients
                .map((rel: any) => ({
                    id: rel.ingredients.id,
                    name: rel.ingredients.name,
                }))
                .filter((ing: any) => ing.id && ing.name), // Filter out any null ingredients
            tags: data.recipe_suggestion_tags
                .map((rel: any) => ({
                    id: rel.tags.id,
                    name: rel.tags.name,
                }))
                .filter((tag: any) => tag.id && tag.name), // Filter out any null tags
        };

        return success(enriched);
    } catch (error) {
        const errorMessage = `Failed to fetch enriched suggestion: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(errorMessage, error);
        return failure(new PersistenceError(errorMessage));
    }
}
