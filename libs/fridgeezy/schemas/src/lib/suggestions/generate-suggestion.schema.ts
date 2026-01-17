import { z } from "zod/v4";

/**
 * Request schema for generating a recipe suggestion.
 * Used by the API to validate incoming requests.
 */
export const GenerateSuggestionRequestSchema = z.object({
    blacklist: z.array(z.string()).optional(),
    component: z.string().optional(),
    course: z.string().optional(),
    cuisine: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    ingredients: z.array(z.string()).optional(),
});

/**
 * Response schema for generated recipe suggestions (from LLM).
 * Used to validate LLM output with string arrays.
 */
export const GenerateSuggestionResponseSchema = z.object({
    name: z.string(),
    description: z.string().max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(z.string()),
    tags: z.array(z.string()),
});

/**
 * Ingredient with ID and name
 */
export const SuggestionIngredientSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Tag with ID and name
 */
export const SuggestionTagSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Enriched response schema with ingredient and tag IDs
 * Used by the API to stream to clients after persistence.
 */
export const EnrichedSuggestionResponseSchema = z.object({
    name: z.string(),
    description: z.string().max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(SuggestionIngredientSchema),
    tags: z.array(SuggestionTagSchema),
});

export type GenerateSuggestionRequestDto = z.infer<
    typeof GenerateSuggestionRequestSchema
>;

export type GenerateSuggestionResponseDto = z.infer<
    typeof GenerateSuggestionResponseSchema
>;

export type SuggestionIngredientDto = z.infer<typeof SuggestionIngredientSchema>;

export type SuggestionTagDto = z.infer<typeof SuggestionTagSchema>;

export type EnrichedSuggestionResponseDto = z.infer<
    typeof EnrichedSuggestionResponseSchema
>;
