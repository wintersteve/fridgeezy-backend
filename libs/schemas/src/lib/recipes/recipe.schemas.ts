import { z } from "zod/v4";

import { clampToDetailLength } from "../text/clamp-description";

/**
 * Shared Zod schemas for recipe generation and manipulation.
 * Single source of truth used by all recipe-related use-cases.
 */

// Schema for header section
export const HeaderSchema = z.object({
    type: z.literal("header"),
    description: z.string().transform(clampToDetailLength),
    // One-sentence version for recipe cards. Optional: the client falls back to
    // `description`.
    shortDescription: z.string().trim().optional(),
    prepTime: z.number(),
    cookTime: z.number(),
});

// Schema for ingredient line
export const IngredientSchema = z.object({
    type: z.literal("ingredient"),
    name: z.string(),
    category: z.string(), // Required for streaming display - but ignored during persistence
    // Optional: the model routinely omits this, and a missing key was making the
    // WHOLE ingredient fail validation (nullable still requires the key present),
    // so every ingredient was being dropped from the recipe.
    parent: z.string().nullable().optional(),
    quantity: z.number(),
    unit: z.string(),
    comment: z.string().optional(),
    ingredientId: z.uuid().optional(), // Added at runtime when generating from suggestion
});

/**
 * `z.coerce.number()` turns `null` into `0` and `""` into `0`, so a step
 * persisted with no temperature would come back through the schema as a real
 * 0°C oven setting. Only `undefined` may mean "absent", so the empties are
 * folded into it before coercion runs.
 *
 * `durationSeconds` escapes the same trap only by accident — its `> 0` test
 * discards the coerced zero — so both fields route through this rather than
 * leaving one correct on purpose and the other by luck.
 */
const absentAsUndefined = (value: unknown) =>
    value === null || value === "" ? undefined : value;

// Schema for instruction line
export const InstructionSchema = z.object({
    type: z.literal("instruction"),
    text: z.string(),
    /**
     * How long the step takes or waits.
     *
     * Optional for the same reason `parent` is on IngredientSchema: the model
     * legitimately omits it on steps with no duration ("season to taste"), and a
     * required key would fail validation for the WHOLE line — silently dropping
     * the step, since a rejected JSONL line is discarded rather than raised.
     *
     * Coerced because the model sometimes writes it as a string. Non-positive
     * values become undefined rather than 0, matching the database's
     * `duration_seconds > 0` constraint: a step taking no time has no duration,
     * and 0 would otherwise render as a "0 m" timer chip.
     */
    durationSeconds: z
        .preprocess(absentAsUndefined, z.coerce.number())
        .transform((value) => (value > 0 ? Math.round(value) : undefined))
        // `.optional()` must sit OUTSIDE the transform, and `.catch()` outside
        // that. A transform wrapping an optional yields `number | undefined` on
        // a key that is still REQUIRED, which breaks every caller that builds an
        // instruction without a duration. `.catch()` then absorbs a value the
        // model wrote as a word — without it a bad duration fails the whole
        // line, and a rejected JSONL line is dropped rather than raised, so the
        // step would vanish from the recipe.
        .optional()
        .catch(undefined)
        .describe("Seconds this step takes or waits; omit when it has none"),
    /**
     * Cooking temperature in whole degrees Celsius — always Celsius, because
     * the prompts mandate it (see TEMPERATURE_RULES) and the client converts
     * for display from the unit setting it persists.
     *
     * Same optional/catch shape as `durationSeconds` above, for the same
     * reason: a value the model garbles must not fail the line and silently
     * drop the step. Out-of-range readings become undefined rather than being
     * stored and rendered as a plainly wrong oven setting.
     */
    temperatureC: z
        .preprocess(absentAsUndefined, z.coerce.number())
        .transform((value) =>
            value >= -40 && value <= 500 ? Math.round(value) : undefined
        )
        .optional()
        .catch(undefined)
        .describe("Cooking temperature in °C; omit when the step has none"),
    ingredients: z
        .array(z.string())
        .optional()
        .describe("Array of ingredient names used in this step"),
    ingredientIds: z
        .array(z.uuid())
        .optional()
        .describe("Array of ingredient UUIDs (added at runtime when generating from suggestion)"),
});

// Schema for tips line
export const TipSchema = z.object({
    type: z.literal("tip"),
    text: z.string(),
});

// Schema for nutrition information (per serving)
// Using z.coerce.number() to handle LLM outputs that may be strings (e.g., "450" instead of 450)
export const NutritionSchema = z.object({
    type: z.literal("nutrition"),
    kcal: z.coerce.number(),
    carbs: z.coerce.number(),
    protein: z.coerce.number(),
    fat: z.coerce.number(),
});
