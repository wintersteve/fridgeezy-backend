import { z } from "zod/v4";

/**
 * Request schema for composing complementary courses for a recipe.
 * Defines the contract for the compose recipe use-case.
 */
export const ComposeRecipeRequestSchema = z.object({
    /**
     * The course slots to fill, spelled EXACTLY as the `course` tag vocabulary
     * does: "appetizer", "main", "side", "dessert". Nothing else resolves.
     *
     * The description used to offer "side dish" as an example. No caller has ever
     * sent that — every one uses the four values verbatim (the client's
     * COURSE_ORDER) — but it made the loose `includes` matching in
     * `generate-compose-suggestions` look load-bearing when it was only hiding
     * the ambiguity this line created.
     */
    courseTypes: z
        .array(z.string().min(1))
        .min(1)
        .describe(
            'Course slots to fill, from the course vocabulary exactly: "appetizer", "main", "side", "dessert"'
        ),
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
    exclude: z
        .array(z.string())
        .default([])
        .describe(
            "Dish names already offered for these courses. Lets a client ask " +
                "for another option without being handed the same dish back — " +
                "dedup is deterministic, so without this a re-request returns " +
                "exactly what it returned the first time."
        ),
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
 * Result DTO for an existing recipe match.
 *
 * `image` matters more than it looks: without it the client cannot tell a
 * sourced recipe from a fresh suggestion, because the card falls back to its
 * "NEW" plate and a dish that is already in the catalogue reads as generated.
 */
export const ComposeRecipeExistingResultSchema = z.object({
    type: z.literal("result"),
    source: z.literal("existing"),
    id: z.uuid().describe("Recipe ID"),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    /** Total minutes, for the time pill beside the difficulty one. */
    totalTimeMinutes: z.number().int().positive().nullable().optional(),
    ingredients: z.array(ComposeItemSchema),
    tags: z.array(ComposeItemSchema),
    image: z.string().nullable().optional().describe("Hero image URL"),
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
    /** Total minutes, for the time pill beside the difficulty one. */
    totalTimeMinutes: z.number().int().positive().nullable().optional(),
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
