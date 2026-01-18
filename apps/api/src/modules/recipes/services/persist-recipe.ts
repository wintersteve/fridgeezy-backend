import { failure, PersistenceError, Result } from "@fridgeezy/domain";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import { RecipesRepository } from "@fridgeezy/supabase";

import { generateAndUploadRecipeImage } from "./create-recipe-image";

const DEFAULT_IMAGE_URL = "";

/**
 * Persist a complete recipe to Supabase.
 *
 * This service orchestrates:
 * 1. Image generation and upload (or reuse existing image if provided)
 * 2. Database persistence via repository
 *
 * @param recipe The recipe data to persist
 * @param existingImageUrl Optional existing image URL to reuse instead of generating a new one
 * @returns Result containing the recipe UUID or error
 */
export async function persistRecipe(
    recipe: GenerateRecipeResponseDto,
    existingImageUrl?: string
): Promise<Result<string, PersistenceError>> {
    try {
        // Use existing image URL if provided, otherwise generate new one
        let imageUrl: string;

        if (existingImageUrl) {
            console.log(
                `Reusing existing image for recipe: ${recipe.name}`
            );
            imageUrl = existingImageUrl;
        } else {
            // Wait for image generation to complete
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
