import { z } from "zod/v4";

/**
 * Request schema for adjusting recipe servings.
 * Defines the contract for the adjust servings endpoint.
 */
export const AdjustServingsRequestSchema = z.object({
    recipeId: z.string().uuid().describe("UUID of the recipe to adjust"),
    servings: z.coerce
        .number()
        .int()
        .positive()
        .min(1)
        .max(100)
        .describe("Desired number of servings (1-100)"),
});

/**
 * Response schema for adjusted recipe servings.
 * Returns the recipe with scaled ingredient quantities.
 */
export const AdjustServingsResponseSchema = z.object({
    recipeId: z.string().uuid(),
    originalServings: z.number().int().positive(),
    adjustedServings: z.number().int().positive(),
    scalingFactor: z.number().positive(),
    ingredients: z.array(
        z.object({
            name: z.string(),
            quantity: z.number(),
            displayQuantity: z.string(),
            unit: z.string(),
            displayUnit: z.string(),
            category: z.string(),
            parent: z.string().nullable(),
        })
    ),
    name: z.string(),
    description: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    prepTime: z.number(),
    cookTime: z.number(),
    instructions: z.array(
        z.object({
            text: z.string(),
            ingredients: z.array(z.string()).optional(),
        })
    ),
    tips: z.array(z.string()).nullable(),
    tags: z.array(z.string()),
});

export type AdjustServingsRequestDto = z.infer<
    typeof AdjustServingsRequestSchema
>;
export type AdjustServingsResponseDto = z.infer<
    typeof AdjustServingsResponseSchema
>;
