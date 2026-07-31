import { z } from "zod/v4";

/**
 * Shared Zod schemas for recipe generation and manipulation.
 * Single source of truth used by all recipe-related use-cases.
 */

// Schema for header section
export const HeaderSchema = z.object({
    type: z.literal("header"),
    description: z.string(),
    // One-sentence version for recipe cards. Optional: the client falls back to
    // `description`.
    shortDescription: z.string().optional(),
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

// Schema for instruction line
export const InstructionSchema = z.object({
    type: z.literal("instruction"),
    text: z.string(),
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
