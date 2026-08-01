import { z } from "zod/v4";

/**
 * Request schema for composing complementary courses for a recipe.
 * Defines the contract for the compose recipe use-case.
 */
export const ComposeRecipeRequestSchema = z.object({
    courseTypes: z
        .array(z.string().min(1))
        .min(1)
        .describe("Desired course types (e.g., appetizer, side dish, dessert)"),
    matchCuisine: z
        .boolean()
        .default(true)
        .describe("Match base recipe's cuisine"),
    matchDifficulty: z
        .boolean()
        .default(true)
        .describe("Match base recipe's difficulty"),
    maxSuggestions: z
        .number()
        .int()
        .default(1)
        .describe("Suggestions per course type"),
    matchThreshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.75)
        .describe("Vector search similarity threshold"),
});

export type ComposeRecipeRequestDto = z.infer<
    typeof ComposeRecipeRequestSchema
>;

/**
 * Ingredient/Tag schema for composed results
 */
const ComposeItemSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Result DTO for an existing recipe match
 */
export const ComposeRecipeExistingResultSchema = z.object({
    type: z.literal("result"),
    source: z.literal("existing"),
    id: z.uuid().describe("Recipe ID"),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(ComposeItemSchema),
    tags: z.array(ComposeItemSchema),
    matchScore: z.number().describe("Vector search similarity score"),
});

/**
 * Result DTO for a new suggestion
 * Matches EnrichedSuggestionResponseDto structure with type discriminator
 */
export const ComposeRecipeSuggestionResultSchema = z.object({
    type: z.literal("result"),
    source: z.literal("suggestion"),
    id: z.uuid().describe("Suggestion ID"),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(ComposeItemSchema),
    tags: z.array(ComposeItemSchema),
});

/**
 * Union of existing recipe and new suggestion results
 */
export const ComposeRecipeResultDtoSchema = z.discriminatedUnion("source", [
    ComposeRecipeExistingResultSchema,
    ComposeRecipeSuggestionResultSchema,
]);

export type ComposeRecipeResultDto = z.infer<
    typeof ComposeRecipeResultDtoSchema
>;

/**
 * Progress DTO for streaming updates.
 */
export const ComposeRecipeProgressDtoSchema = z.object({
    type: z.literal("progress"),
    stage: z.enum(["searching", "generating", "complete"]),
    courseType: z.string(),
    message: z.string(),
});

export type ComposeRecipeProgressDto = z.infer<
    typeof ComposeRecipeProgressDtoSchema
>;
