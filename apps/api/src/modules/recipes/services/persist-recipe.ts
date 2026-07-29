import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import { RecipesRepository, UnitsRepository } from "@fridgeezy/supabase";

import {
    generateAndUploadRecipeImage,
    getRecipeImagePublicUrl,
} from "./create-recipe-image";

const DEFAULT_IMAGE_URL = "";
const unitsRepository = new UnitsRepository();

/**
 * Resolve every ingredient's free-text unit to a valid abbreviation, mutating
 * each ingredient in place. Resolutions are independent, so they run in
 * parallel (a direct lookup, plus a vector-search fallback + embedding on miss)
 * instead of one round-trip per ingredient. Fails on the first unit that can't
 * be resolved.
 */
async function resolveIngredientUnits(
    ingredients: GenerateRecipeResponseDto["ingredients"]
): Promise<Result<void, PersistenceError>> {
    const resolutions = await Promise.all(
        ingredients.map(async (ingredient) => {
            // 1. Try direct lookup (canonical_id, then abbreviation)
            let unitResult = await unitsRepository.resolveUnit(ingredient.unit);

            // 2. If not found, try vector search fallback
            if (!unitResult.success) {
                const embedding = await generateEmbedding(ingredient.unit);
                unitResult = await unitsRepository.resolveUnit(
                    ingredient.unit,
                    embedding
                );
            }

            return { ingredient, unitResult };
        })
    );

    for (const { ingredient, unitResult } of resolutions) {
        if (!unitResult.success) {
            return failure(
                new PersistenceError(
                    `Unit "${ingredient.unit}" not found for ingredient "${ingredient.name}"`
                )
            );
        }
        // Update the unit to use the valid abbreviation
        ingredient.unit = unitResult.value.abbreviation;
    }

    return success(undefined);
}

/**
 * Collapse ingredients that resolve to the same DB ingredient. The
 * `recipe_ingredients` table allows only one row per (recipe, ingredient), but
 * the LLM sometimes lists an ingredient more than once (e.g. an egg "for dough"
 * and "for wash"), which resolves to a single ingredient id and would otherwise
 * violate the unique constraint. Merge duplicates by ingredientId — summing
 * quantities when the unit matches, else keeping the first. Ingredients without
 * an ingredientId are left as-is (a NULL id doesn't collide).
 */
function dedupeIngredientsById(
    ingredients: GenerateRecipeResponseDto["ingredients"]
): GenerateRecipeResponseDto["ingredients"] {
    const byId = new Map<
        string,
        GenerateRecipeResponseDto["ingredients"][number]
    >();
    const result: GenerateRecipeResponseDto["ingredients"] = [];

    for (const ingredient of ingredients) {
        const id = (ingredient as { ingredientId?: string }).ingredientId;

        if (!id) {
            result.push(ingredient);
            continue;
        }

        const existing = byId.get(id);
        if (!existing) {
            byId.set(id, ingredient);
            result.push(ingredient);
            continue;
        }

        // Same ingredient again — fold it into the first occurrence.
        if (
            existing.unit === ingredient.unit &&
            typeof existing.quantity === "number" &&
            typeof ingredient.quantity === "number"
        ) {
            existing.quantity += ingredient.quantity;
        }
    }

    return result;
}

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

        // Resolve unit strings to valid abbreviations before persisting
        const unitsResolved = await resolveIngredientUnits(recipe.ingredients);
        if (!unitsResolved.success) {
            return unitsResolved;
        }

        // Persist to database via repository
        const repository = new RecipesRepository();

        const result = await repository.persist(recipe, imageUrl);

        // Store the name embedding app-side (text-embedding-3-small) so Postgres
        // never calls OpenAI. Best-effort — don't fail the save if this fails.
        if (result.success) {
            const embedding = await generateEmbedding(recipe.name);
            const embeddingResult = await repository.updateEmbedding(
                result.value,
                embedding
            );
            if (!embeddingResult.success) {
                console.error(
                    `Failed to store embedding for recipe "${recipe.name}":`,
                    embeddingResult.error
                );
            }
        }

        return result;
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}

/**
 * Persist a recipe using ingredient IDs directly (no canonical_id lookup needed).
 * Used when generating a recipe from a suggestion where ingredient IDs are already known.
 *
 * @param recipe The recipe data with ingredientId attached to each ingredient
 * @returns Result containing the recipe UUID or error
 */
export async function persistRecipeWithIngredientIds(
    recipe: GenerateRecipeResponseDto
): Promise<Result<string, PersistenceError>> {
    try {
        // Collapse ingredients that map to the same DB ingredient so the insert
        // doesn't violate recipe_ingredients' (recipe_id, ingredient_id) unique key.
        recipe.ingredients = dedupeIngredientsById(recipe.ingredients);

        // The recipe stream already kicked off image generation (fire-and-forget)
        // for this exact name, and it lands at a deterministic path. Use that URL
        // now instead of generating a SECOND time and blocking the save on the
        // (slow, costly) image model — the async upload backfills the file.
        const imageUrl = getRecipeImagePublicUrl(recipe.name);

        // Resolve unit strings to valid abbreviations before persisting
        const unitsResolved = await resolveIngredientUnits(recipe.ingredients);
        if (!unitsResolved.success) {
            return unitsResolved;
        }

        // Persist using ingredient IDs
        const repository = new RecipesRepository();
        const result = await repository.persistWithIngredientIds(recipe, imageUrl);

        // Store the name embedding app-side (text-embedding-3-small) so Postgres
        // never calls OpenAI. Best-effort — don't fail the save if this fails.
        if (result.success) {
            const embedding = await generateEmbedding(recipe.name);
            const embeddingResult = await repository.updateEmbedding(
                result.value,
                embedding
            );
            if (!embeddingResult.success) {
                console.error(
                    `Failed to store embedding for recipe "${recipe.name}":`,
                    embeddingResult.error
                );
            }
        }

        return result;
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
