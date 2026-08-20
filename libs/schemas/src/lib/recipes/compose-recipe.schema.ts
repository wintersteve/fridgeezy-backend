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
    /**
     * How many dishes each slot wants, keyed by the same course names
     * `courseTypes` uses. Optional, and `maxSuggestions` remains the fallback
     * for any course missing from it.
     *
     * It exists because `maxSuggestions` is ONE number for the whole request
     * while the caller's wants are per-course: a menu asking for two sides and
     * one dessert used to send `2`, which the prompt renders as "2 per course
     * type" — so the model generated a second dessert that the client then
     * dropped on the floor, after it had been reviewed, embedded and persisted.
     */
    courseCounts: z
        .record(z.string(), z.number().int().positive())
        .default({})
        .describe("Dishes wanted per course type; overrides maxSuggestions"),
    /**
     * Ingredients the user will not eat. Compose adapts around them rather than
     * dropping the dish — see BLACKLIST_RULE, the same rule the discovery feed
     * applies.
     *
     * Compose ran without this for a long time, which made it the only
     * generation endpoint in the product with no personalisation channel — and
     * the only paid one. The main a menu is built around is already filtered by
     * the caller's blacklist; the courses composed around it were chosen blind.
     */
    blacklist: z
        .array(z.string())
        .default([])
        .describe("Ingredient names the user will not eat"),
    /** Absolute, unlike the blacklist: the dish itself must already comply. */
    dietaryRestrictions: z
        .array(z.string())
        .default([])
        .describe("Dietary restrictions every composed course must satisfy"),
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
    /**
     * The slot this dish was generated to fill, echoed back from the request.
     *
     * Load-bearing, and it is the field whose absence caused the worst class of
     * bug in this endpoint's client. Without it the client has to infer the slot
     * from the dish's own `tags` — and for an EXISTING match those are the
     * catalogue row's tags, decided when that recipe was first generated and
     * unrelated to the slot just asked for. A side that dedup resolved onto a
     * recipe tagged `main` was bucketed as a main, matched no requested slot,
     * and vanished with no card and no message after being paid for twice over.
     */
    courseType: z.string().describe("Requested course slot this dish fills"),
    id: z.uuid().describe("Recipe ID"),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    /** Total minutes, for the time pill beside the difficulty one. */
    totalTimeMinutes: z.number().int().positive().nullable().optional(),
    ingredients: z.array(ComposeItemSchema),
    tags: z.array(ComposeItemSchema),
    /**
     * The one-line card copy. `description` is the detail-screen paragraph and
     * truncates mid-sentence on a card, which is why every other card surface in
     * the app prefers this — compose was the one that could not, because the
     * schema had nowhere to put it and `parse` stripped what the query loaded.
     */
    shortDescription: z.string().nullable().optional(),
    image: z.string().nullable().optional().describe("Hero image URL"),
});

/**
 * Result DTO for a new suggestion
 * Matches EnrichedSuggestionResponseDto structure with type discriminator
 */
export const ComposeRecipeSuggestionResultSchema = z.object({
    type: z.literal("result"),
    source: z.literal("suggestion"),
    /** The slot this dish fills — see the note on the existing-result twin. */
    courseType: z.string().describe("Requested course slot this dish fills"),
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

/**
 * A slot that was asked for and will not be filled.
 *
 * Compose drops dishes for reasons the caller cannot see — the model returned a
 * name on the exclusion list, or the authenticity gate refused it — and used to
 * simply `continue`, so a requested course ended in silence indistinguishable
 * from one still streaming. The discovery feed has had this shape since the
 * pending-slot protocol went in: a slot is reserved, then filled OR withdrawn,
 * and nothing on screen ever changes its mind.
 */
export const ComposeRecipeWithdrawnDtoSchema = z.object({
    type: z.literal("withdrawn"),
    courseType: z.string(),
    /** The dish that was dropped, for the log — the client shows the slot. */
    name: z.string(),
    /**
     * Mirrors `SuggestionOutcome`'s drop reasons, plus `excluded` for a dish the
     * caller had already been offered. Kept as a closed set so a client can
     * choose its wording — "we couldn't find another side" reads very
     * differently from "that one turned out not to be a real dish".
     */
    reason: z.enum([
        "excluded",
        "duplicate",
        "not_food",
        "unauthentic",
        "persist_failed",
        "invalid",
    ]),
});

export type ComposeRecipeWithdrawnDto = z.infer<
    typeof ComposeRecipeWithdrawnDtoSchema
>;

/**
 * What to call the whole meal.
 *
 * Emitted once, before the courses, and it exists because `menus.name` had
 * nowhere better to come from: the client defaulted it to the main course's
 * name, so a saved meal was titled "Coq au Vin" above a course row also called
 * "Coq au Vin". `toReaderHref` in the client already carried a comment
 * admitting it "names one dish rather than the dinner".
 *
 * Free, which is why it is here rather than in a second call: the composition
 * prompt already knows the base dish, its cuisine and every slot being filled,
 * so the title is one more line of the JSONL it was already streaming.
 *
 * OPTIONAL BY CONSTRUCTION. It is a nicety on an expensive stream, so nothing
 * downstream may depend on it arriving — the generator drops a title it cannot
 * clean rather than failing the frame, and every consumer falls back to the main
 * course's name. A menu composed before this shipped has no title frame at all
 * and must keep working.
 */
export const ComposeRecipeMenuDtoSchema = z.object({
    type: z.literal("menu"),
    /**
     * Deliberately only `min(1)`. Length and shape are enforced UPSTREAM, in the
     * generator, because this schema is `parse`d inside the streaming loop where
     * a throw is caught as a stream failure — a rambling title would abort a
     * paid composition that had otherwise succeeded. Sanitise, never reject.
     */
    title: z.string().min(1).describe("Name for the whole meal"),
});

export type ComposeRecipeMenuDto = z.infer<typeof ComposeRecipeMenuDtoSchema>;

/**
 * A stream that gave up.
 *
 * The route has always written this frame on a mid-stream throw, and it was
 * never declared — so the client parsed it as an ordinary item, appended it, and
 * then took the `[DONE]` success path with `error` still null. A failed
 * composition arrived at the UI as an empty menu that was then written to cache
 * as valid. Declaring it is what lets a client tell the two apart.
 */
export const ComposeRecipeErrorDtoSchema = z.object({
    type: z.literal("error"),
    message: z.string(),
});

export type ComposeRecipeErrorDto = z.infer<typeof ComposeRecipeErrorDtoSchema>;

/** Every frame this endpoint can emit, for a client that must handle them all. */
export type ComposeRecipeFrameDto =
    | ComposeRecipeResultDto
    | ComposeRecipeProgressDto
    | ComposeRecipeMenuDto
    | ComposeRecipeWithdrawnDto
    | ComposeRecipeErrorDto;
