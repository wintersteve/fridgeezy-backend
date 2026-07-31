import { z } from "zod/v4";

/**
 * An ingredient the cook does not have, as picked from the recipe. Carries the
 * ingredient row id so the client can key its cards off the same value it sent.
 */
export const MissingIngredientSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Request schema for suggesting substitutes for the ingredients a cook is
 * missing from one recipe.
 *
 * `recipeId` is used to look the recipe up for prompt context (its other
 * ingredients and its cuisine tag change what a good swap is); `recipeName` is
 * what the prompt falls back to when that lookup misses, so both are required.
 */
export const SuggestSubstitutesRequestSchema = z.object({
    recipeId: z.string(),
    recipeName: z.string(),
    missingIngredients: z.array(MissingIngredientSchema),
});

/**
 * One substitution option.
 *
 * `ratio` is omitted rather than guessed when a swap has no meaningful
 * conversion, and `note` is a short "when to use this" aside — the client
 * renders the name inline with the ratio and the note beneath it, so both must
 * read as fragments, not sentences.
 */
export const SubstituteOptionSchema = z.object({
    name: z.string(),
    ratio: z.string().optional(),
    note: z.string().optional(),
});

/**
 * One streamed frame: the substitutes for a single missing ingredient.
 *
 * Exactly one frame is emitted per requested ingredient, in request order — the
 * client renders a skeleton per not-yet-received ingredient by slicing its
 * request list, so a skipped or duplicated frame leaves a card stuck or collides
 * on the `ingredientName` React key.
 */
export const SubstituteSuggestionSchema = z.object({
    ingredientName: z.string(),
    substitutes: z.array(SubstituteOptionSchema),
});

/**
 * LLM output shape, in the repo's snake_case convention, before it is mapped
 * onto {@link SubstituteSuggestionSchema}.
 *
 * `ratio` and `note` accept null as well as absent because models reliably emit
 * explicit nulls for "not applicable"; the mapping drops them so the wire shape
 * stays optional-or-absent.
 */
export const SubstituteSuggestionLlmSchema = z.object({
    ingredient_name: z.string(),
    substitutes: z.array(
        z.object({
            name: z.string(),
            ratio: z.string().nullable().optional(),
            note: z.string().nullable().optional(),
        })
    ),
});

export type MissingIngredientDto = z.infer<typeof MissingIngredientSchema>;

export type SuggestSubstitutesRequestDto = z.infer<
    typeof SuggestSubstitutesRequestSchema
>;

export type SubstituteOptionDto = z.infer<typeof SubstituteOptionSchema>;

export type SubstituteSuggestionDto = z.infer<typeof SubstituteSuggestionSchema>;

export type SubstituteSuggestionLlmDto = z.infer<
    typeof SubstituteSuggestionLlmSchema
>;
