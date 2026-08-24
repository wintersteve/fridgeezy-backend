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
 *
 * **`blacklist` and `dietaryRestrictions` bind the OUTPUT here, not the dish.**
 * Everywhere else they steer what a generator *writes*: `BLACKLIST_RULE` swaps
 * the offending ingredient or skips the dish outright, and a restriction sends
 * the model off to pick a different dish entirely. This endpoint picks no dish
 * and rewrites nothing — the recipe stays exactly as it is, and these two only
 * say what may not be NAMED as a swap. A cook who wants the dish itself changed
 * wants `/recipes/modify`, which is the same division
 * {@link ImportRecipeRequestSchema} draws for the same reason.
 *
 * Both optional; absent means unconstrained. The prompt is told about them and
 * is also not trusted with them — see the output filter in
 * `generate-substitutes-stream.ts`.
 */
export const SuggestSubstitutesRequestSchema = z.object({
    recipeId: z.string(),
    recipeName: z.string(),
    missingIngredients: z.array(MissingIngredientSchema),
    blacklist: z
        .array(z.string())
        .optional()
        .describe("Ingredient NAMES the cook will not eat, e.g. ['peanuts']"),
    dietaryRestrictions: z
        .array(z.string())
        .optional()
        .describe("Dietary tags to respect, e.g. ['vegan', 'gluten_free']"),
});

/**
 * One substitution option.
 *
 * `ratio` is omitted rather than guessed when a swap has no meaningful
 * conversion, and `note` is a short "when to use this" aside — the client
 * renders the name inline with the ratio and the note beneath it, so both must
 * read as fragments, not sentences.
 *
 * **`ratio` is free text and is NOT a multiplier.** It carries "1:1" and "3/4
 * the amount", but also "1 tbsp per clove" — a unit change no scalar can
 * express. The client applies it to the quantity only when it parses as a clean
 * scalar and renders it as text otherwise; do not tighten this to a number
 * without also deciding what a unit-changing swap returns.
 *
 * `changesMethod` is what lets the client offer a full rewrite on the swaps
 * that need one and stay free on the swaps that do not. Oil for butter in a
 * pan sauce is a straight swap; in shortcrust it changes how the pastry is
 * made, and only the model knows which of the two it just suggested.
 */
export const SubstituteOptionSchema = z.object({
    name: z.string(),
    ratio: z.string().optional(),
    note: z.string().optional(),
    changesMethod: z.boolean().optional(),
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
            // Absent means "no", so a model that ignores the field leaves every
            // swap on the free path rather than offering a paid rewrite nobody
            // asked for. The failure direction is deliberate.
            changes_method: z.boolean().nullable().optional(),
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
