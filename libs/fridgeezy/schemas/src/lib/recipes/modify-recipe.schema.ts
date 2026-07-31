import { z } from "zod/v4";

/**
 * Request schema for modifying a recipe from a free-form user instruction
 * (e.g. "make it vegetarian", "swap the cream for coconut milk"). The result is
 * a NEW recipe row (a variant) that keeps the same dish identity, name and
 * difficulty as the source; only the content changes.
 */
export const ModifyRecipeRequestSchema = z.object({
    id: z.uuid().describe("UUID of the recipe to modify"),
    instruction: z
        .string()
        .min(1)
        .describe("The user's modification request in natural language"),
    dietaryRestrictions: z
        .array(z.string())
        .optional()
        .describe("Dietary tags to respect, e.g. ['vegan', 'gluten_free']"),
});
