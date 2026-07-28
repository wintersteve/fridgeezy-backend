import {
    failure,
    IRecipesRepository,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";

import { supabaseAdmin } from "../../client";

export class RecipesRepository implements IRecipesRepository {
    /**
     * Persist a complete recipe with all related entities.
     *
     * Calls the persist_recipe RPC function which atomically creates:
     * - Recipe record
     * - Ingredient records (find or create)
     * - Recipe-ingredient associations
     * - Instruction records
     * - Tag records (find or create)
     * - Recipe-tag associations
     */
    async persist(
        recipe: GenerateRecipeResponseDto,
        imageUrl: string
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data, error } = await supabaseAdmin.rpc("persist_recipe", {
                p_name: recipe.name,
                p_description: recipe.description || "",
                p_difficulty: recipe.difficulty,
                p_servings: recipe.servings,
                p_prep_time: `${recipe.prepTime} min`,
                p_cook_time: `${recipe.cookTime} min`,
                p_kcal: recipe.kcal,
                p_carbs: recipe.carbs,
                p_protein: recipe.protein,
                p_fat: recipe.fat,
                p_tips: recipe.tips?.map((tip) => tip.text) || [],
                p_image: imageUrl,
                p_ingredients: recipe.ingredients,
                p_instructions: recipe.instructions.map((inst, idx) => ({
                    step_number: idx + 1,
                    text: inst.text,
                    ingredients: inst.ingredients || [],
                })),
                p_tags: recipe.tags || [],
                p_name_en: recipe.nameEn ?? null,
            });

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            if (!data) {
                return failure(
                    new PersistenceError(
                        "Failed to persist recipe: no ID returned"
                    )
                );
            }

            return success(data as string);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Persist a recipe using ingredient IDs directly (no canonical_id lookup).
     * Used when generating from a suggestion where ingredient IDs are already known.
     *
     * Calls the persist_recipe_with_ingredient_ids RPC function which:
     * - Uses ingredient_id directly instead of looking up by name
     * - Uses ingredient_ids (UUIDs) for instructions instead of name-to-id mapping
     * - Tags still use create-if-not-exists pattern
     */
    async persistWithIngredientIds(
        recipe: GenerateRecipeResponseDto,
        imageUrl: string
    ): Promise<Result<string, PersistenceError>> {
        try {
            // Type assertion needed until database types are regenerated after migration
            const { data, error } = await (supabaseAdmin.rpc as any)(
                "persist_recipe_with_ingredient_ids",
                {
                    p_name: recipe.name,
                    p_description: recipe.description || "",
                    p_difficulty: recipe.difficulty,
                    p_servings: recipe.servings,
                    p_prep_time: `${recipe.prepTime} min`,
                    p_cook_time: `${recipe.cookTime} min`,
                    p_kcal: recipe.kcal,
                    p_carbs: recipe.carbs,
                    p_protein: recipe.protein,
                    p_fat: recipe.fat,
                    p_tips: recipe.tips?.map((tip) => tip.text) || [],
                    p_image: imageUrl,
                    p_ingredients: recipe.ingredients.map((ing) => ({
                        ingredient_id: (ing as any).ingredientId,
                        quantity: ing.quantity,
                        unit: ing.unit,
                        comment: (ing as any).comment || null,
                    })),
                    p_instructions: recipe.instructions.map((inst, idx) => ({
                        step_number: idx + 1,
                        text: inst.text,
                        ingredient_ids: (inst as any).ingredientIds || [],
                    })),
                    p_tags: recipe.tags || [],
                    p_name_en: recipe.nameEn ?? null,
                }
            );

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            if (!data) {
                return failure(
                    new PersistenceError(
                        "Failed to persist recipe: no ID returned"
                    )
                );
            }

            return success(data as string);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Record a freshly persisted recipe as a variant of the recipe it was
     * modified from. A variant keeps the base's name, so this is what keeps the
     * duplicate out of search/discovery — it must run whether or not the user
     * goes on to save the variant.
     *
     * Families stay flat: modifying a variant points the new row at that
     * variant's own base, never at the variant.
     *
     * @returns Result containing the family's base recipe UUID or error
     */
    async markAsVariant(
        recipeId: string,
        sourceRecipeId: string
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data: source, error: sourceError } = await supabaseAdmin
                .from("recipes")
                .select("base_recipe_id")
                .eq("id", sourceRecipeId)
                .maybeSingle();

            if (sourceError) {
                return failure(
                    new PersistenceError(`Database error: ${sourceError.message}`)
                );
            }

            const baseRecipeId = source?.base_recipe_id ?? sourceRecipeId;

            const { error } = await supabaseAdmin
                .from("recipes")
                .update({ base_recipe_id: baseRecipeId })
                .eq("id", recipeId);

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            return success(baseRecipeId);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to mark recipe as variant: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }
}
