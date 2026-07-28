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

export type ModifyRecipeRequestDto = z.infer<typeof ModifyRecipeRequestSchema>;

/**
 * Terminal frame emitted after the modified recipe has been persisted, carrying
 * the new row's id and a short human-readable label describing the change. The
 * client uses the id to navigate to / save the variant and the label as the
 * default variant name.
 */
export const ModifyRecipeVariantSchema = z.object({
    type: z.literal("variant"),
    id: z.uuid(),
    label: z.string(),
});

export type ModifyRecipeVariant = z.infer<typeof ModifyRecipeVariantSchema>;
