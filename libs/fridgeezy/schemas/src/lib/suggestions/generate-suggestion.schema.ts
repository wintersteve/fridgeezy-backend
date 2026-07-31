import { z } from "zod/v4";

/**
 * Card descriptions are capped, but at a word boundary — the previous
 * `slice(0, 50)` cut mid-word ("...with fresh basil and par").
 */
const CARD_DESCRIPTION_MAX = 60;

const clampToCardLength = (value: string): string => {
    const trimmed = value.trim();

    if (trimmed.length <= CARD_DESCRIPTION_MAX) {
        return trimmed;
    }

    const cut = trimmed.slice(0, CARD_DESCRIPTION_MAX);
    const lastSpace = cut.lastIndexOf(" ");

    // A space this early means one very long word: keep the hard cut.
    const clamped = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;

    return `${clamped.replace(/[\s,;:-]+$/, "")}…`;
};

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
    name_en: z.string(),
    description: z.string().transform(clampToCardLength),
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
    id: z.uuid(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string().transform(clampToCardLength),
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

export type SuggestionIngredientDto = z.infer<
    typeof SuggestionIngredientSchema
>;

export type SuggestionTagDto = z.infer<typeof SuggestionTagSchema>;

export type EnrichedSuggestionResponseDto = z.infer<
    typeof EnrichedSuggestionResponseSchema
>;
