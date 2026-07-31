import { z } from "zod/v4";

import {
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "./recipe.schemas";

/**
 * Request schema for generating a recipe from a suggestion.
 * Only requires the suggestion ID - all other data (name, difficulty, ingredients, tags)
 * is fetched server-side from the suggestion.
 */
export const GenerateRecipeRequestSchema = z.object({
    suggestionId: z.uuid().describe("The suggestion ID to generate a recipe from"),
    servings: z.number().int().positive().default(4),
});

export type GenerateRecipeRequestDto = z.infer<
    typeof GenerateRecipeRequestSchema
>;

/**
 * Full recipe schema for persistence.
 * Used by both generate-recipe and escalate-difficulty use-cases.
 * Composed from the schemas above without the type discriminator.
 */
export const GenerateRecipeResponseDtoSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string(),
    shortDescription: z.string().nullable().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    servings: z.number(),
    prepTime: z.number(),
    cookTime: z.number(),
    kcal: z.number(),
    carbs: z.number(),
    protein: z.number(),
    fat: z.number(),
    ingredients: z.array(IngredientSchema.omit({ type: true })),
    instructions: z.array(InstructionSchema.omit({ type: true })),
    tips: z.array(TipSchema.omit({ type: true })).nullable(),
    tags: z.array(z.string()),
});

export type GenerateRecipeResponseDto = z.infer<
    typeof GenerateRecipeResponseDtoSchema
>;
