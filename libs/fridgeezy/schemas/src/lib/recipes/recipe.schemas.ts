import { z } from "zod/v4";

/**
 * Shared Zod schemas for recipe generation and manipulation.
 * Single source of truth used by all recipe-related use-cases.
 */

// Schema for header section
export const HeaderSchema = z.object({
    type: z.literal("header"),
    description: z.string(),
    prepTime: z.number(),
    cookTime: z.number(),
});

// Schema for ingredient line
export const IngredientSchema = z.object({
    type: z.literal("ingredient"),
    name: z.string(),
    category: z.string(), // Required for streaming display - but ignored during persistence
    parent: z.string().nullable(),
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
