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
}
