import { z } from "zod/v4";

/**
 * Request schema for generating a recipe from a suggestion.
 * Defines the contract for external systems calling the generate recipe use-case.
 */
export const GenerateRecipeRequestSchema = z.object({
    difficulty: z.enum(["easy", "medium", "hard"]),
    name: z.string().min(1).describe("Recipe name from the suggestion"),
    ingredients: z
        .array(z.string().min(1))
        .min(1)
        .describe("Ingredients from the suggestion"),
    servings: z.number().int().positive().default(4),
    tags: z.array(z.string()),
});

export type GenerateRecipeRequestDto = z.infer<
    typeof GenerateRecipeRequestSchema
>;
