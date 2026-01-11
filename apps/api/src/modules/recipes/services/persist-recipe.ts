import { failure, PersistenceError, Result } from "@fridgeezy/domain";
import { RecipeResponse } from "@fridgeezy/schemas";
import { RecipesRepository } from "@fridgeezy/supabase";

import { generateAndUploadRecipeImage } from "./create-recipe-image";

const DEFAULT_IMAGE_URL = "";

/**
 * Persist a complete recipe to Supabase.
 *
 * This service orchestrates:
 * 1. Image generation and upload
 * 2. Database persistence via repository
 *
 * @param recipe The recipe data to persist
 * @returns Result containing the recipe UUID or error
 */
export async function persistRecipe(
    recipe: RecipeResponse
): Promise<Result<string, PersistenceError>> {
    try {
        // Wait for image generation to complete
        let imageUrl: string;
        try {
            imageUrl = await generateAndUploadRecipeImage(recipe.name);

            // If image generation returns empty string, use default
            if (!imageUrl) {
                console.warn(
                    `Image generation returned empty URL for recipe: ${recipe.name}, using default`
                );
                imageUrl = DEFAULT_IMAGE_URL;
            }
        } catch (error) {
            console.error(
                "Image generation failed, using default:",
                error instanceof Error ? error.message : error
            );
            imageUrl = DEFAULT_IMAGE_URL;
        }

        // Persist to database via repository
        const repository = new RecipesRepository();
        const result = await repository.persist(recipe, imageUrl);

        return result;
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
