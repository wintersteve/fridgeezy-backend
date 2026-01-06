import { z } from "zod/v4";

/**
 * Request schema for generating a recipe from a suggestion.
 * Defines the contract for external systems calling the generate recipe use-case.
 */
export const GenerateRecipeRequestSchema = z.object({
    title: z.string().min(1).describe("Recipe title from the suggestion"),
    ingredients: z
        .array(z.string().min(1))
        .min(1)
        .describe("Ingredients from the suggestion"),
    servings: z.number().int().positive().default(4),
    dietaryRestrictions: z.array(z.string()).nullable().optional(),
});

export type GenerateRecipeRequest = z.infer<typeof GenerateRecipeRequestSchema>;
