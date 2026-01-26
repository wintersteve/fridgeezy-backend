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
    category: z.string(),
    parent: z.string().nullable(),
    quantity: z.number(),
    unit: z.string(),
    comment: z.string().optional(),
});

// Schema for instruction line
export const InstructionSchema = z.object({
    type: z.literal("instruction"),
    text: z.string(),
    ingredients: z
        .array(z.string())
        .optional()
        .describe("Array of ingredient names used in this step"),
});

// Schema for tips line
export const TipSchema = z.object({
    type: z.literal("tip"),
    text: z.string(),
});

// Schema for nutrition information (per serving)
export const NutritionSchema = z.object({
    type: z.literal("nutrition"),
    kcal: z.number(),
    carbs: z.number(),
    protein: z.number(),
    fat: z.number(),
});
