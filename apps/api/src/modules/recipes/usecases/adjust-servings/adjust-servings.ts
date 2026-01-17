import { Request, Response } from "express";
import {
    AdjustServingsRequestSchema,
    AdjustServingsResponseSchema,
} from "@fridgeezy/schemas";
import { fetchRecipe } from "../../services";
import {
    adjustIngredientQuantities,
    normalizeQuantityDisplay,
} from "../../services";

/**
 * Use-case handler for adjusting recipe servings.
 * Calculates adjusted ingredient quantities based on desired servings.
 */
export async function adjustServings(
    req: Request,
    res: Response
): Promise<void> {
    try {
        // 1. Validate input
        const input = AdjustServingsRequestSchema.parse({
            recipeId: req.params.recipeId,
            servings: req.query.servings,
        });

        // 2. Fetch recipe
        const recipe = await fetchRecipe(input.recipeId);

        if (!recipe) {
            res.status(404).json({
                error: "Recipe not found",
                recipeId: input.recipeId,
            });
            return;
        }

        // 3. Calculate scaling factor
        const scalingFactor = input.servings / recipe.servings;

        // 4. Adjust quantities with rounding
        const adjustedIngredients = adjustIngredientQuantities(
            recipe.ingredients,
            scalingFactor
        );

        // 5. Normalize display (1000g → 1kg)
        const displayIngredients = adjustedIngredients.map((ing) =>
            normalizeQuantityDisplay(ing)
        );

        // 6. Build response
        const response = {
            recipeId: input.recipeId,
            originalServings: recipe.servings,
            adjustedServings: input.servings,
            scalingFactor,
            ingredients: displayIngredients,
            name: recipe.name,
            description: recipe.description,
            difficulty: recipe.difficulty,
            prepTime: recipe.prepTime,
            cookTime: recipe.cookTime,
            instructions: recipe.instructions,
            tips: recipe.tips,
            tags: recipe.tags,
        };

        // 7. Validate and return
        const validated = AdjustServingsResponseSchema.parse(response);
        res.status(200).json(validated);
    } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
            res.status(400).json({
                error: "Invalid request parameters",
                details: error,
            });
        } else {
            throw error;
        }
    }
}
