import { z } from "zod/v4";

/**
 * Request schema for generating a recipe suggestion.
 * Used by the API to validate incoming requests.
 */
export const GenerateSuggestionRequestSchema = z.object({
    blacklist: z.array(z.string()).optional(),
    component: z.string().optional(),
    course: z.string().optional(),
    cuisine: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    ingredients: z.array(z.string()).optional(),
});

/**
 * Response schema for generated recipe suggestions (from LLM).
 * Used to validate LLM output with string arrays.
 *
 * `name` is the CANONICAL name — the one an English-speaking home cook knows the
 * dish by, native or translated depending on the dish.
 * `name_alt` is the other name, and is genuinely optional: a dish like Kimchi or
 * Pad Thai has only one. Requiring it (it used to be `z.string()`, back when it
 * meant "the English translation") forced the model to either echo `name` or
 * invent a translation nobody uses.
 */
export const GenerateSuggestionResponseSchema = z.object({
    name: z.string(),
    name_alt: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(z.string()),
    tags: z.array(z.string()),
    /**
     * Blacklisted ingredients this dish was adapted around — the model swapped
     * each one for an authentic substitute instead of dropping the dish.
     *
     * Optional because it is a per-REQUEST fact, not a property of the dish: the
     * suggestion row is shared by dedup, so this is carried on the stream frames
     * and never persisted. A user with no blacklist gets an empty one.
     */
    adaptedFor: z.array(z.string()).optional(),
});

/**
 * Ingredient with ID and name
 */
export const SuggestionIngredientSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Tag with ID and name
 */
export const SuggestionTagSchema = z.object({
    id: z.string(),
    name: z.string(),
});

/**
 * Enriched response schema with ingredient and tag IDs
 * Used by the API to stream to clients after persistence.
 *
 * `nameEn` mirrors the `name_en` COLUMN, which holds the ALTERNATE name rather
 * than an English translation — the two swapped meanings. Clients render `name` and
 * ignore this.
 */
export const EnrichedSuggestionResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(SuggestionIngredientSchema),
    tags: z.array(SuggestionTagSchema),
});

/**
 * The card as the model wrote it, emitted BEFORE any database work.
 *
 * `/suggestions/generate` sends each suggestion twice: this frame the moment the
 * model finishes writing it, then {@link StreamedSuggestionSchema} once it is
 * persisted. Everything between the two — embedding, dedup searches,
 * ingredient/tag matching, the insert — takes several seconds and changes
 * nothing visible except resolving ids, so holding the card back for it was
 * most of the wait.
 *
 * It has no `id` because the row does not exist yet, and its ingredient/tag ids
 * are synthesised with a `temp:` prefix. Never treat those as real.
 */
export const ProvisionalSuggestionSchema = z.object({
    /** Matches the `tempId` on the enriched frame for the same dish. */
    tempId: z.string(),
    name: z.string(),
    nameEn: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(SuggestionIngredientSchema),
    tags: z.array(SuggestionTagSchema),
    /** @see GenerateSuggestionResponseSchema.adaptedFor */
    adaptedFor: z.array(z.string()).optional(),
});

/**
 * The persisted card, carrying the `tempId` of the provisional frame it
 * replaces. A client keying on `tempId` upgrades the card in place; one that
 * ignores it renders the dish twice.
 *
 * Separate from {@link EnrichedSuggestionResponseSchema} so that type stays the
 * shape of a persisted suggestion everywhere else in the app, with no `tempId`
 * for callers that never stream.
 */
export const StreamedSuggestionSchema = EnrichedSuggestionResponseSchema.extend({
    tempId: z.string(),
    /**
     * Repeated from the provisional frame so the card keeps its "adapted"
     * marker when this frame replaces it. Not read back from the database —
     * the row has no such column, deliberately (@see
     * GenerateSuggestionResponseSchema.adaptedFor).
     */
    adaptedFor: z.array(z.string()).optional(),
});

/**
 * Withdraws a provisional card that will never be enriched.
 *
 * A dish can disappear after its provisional frame has already been sent: dedup
 * may resolve it to a recipe the user already has, or the authenticity gate may
 * reject it. Before provisional frames existed those outcomes were simply not
 * emitted and nothing was ever shown. Now the card is already on screen, so
 * silence would leave a dish the user can look at but never open.
 */
export const WithdrawnSuggestionSchema = z.object({
    tempId: z.string(),
    withdrawn: z.literal(true),
});

export type WithdrawnSuggestionDto = z.infer<typeof WithdrawnSuggestionSchema>;

export type ProvisionalSuggestionDto = z.infer<typeof ProvisionalSuggestionSchema>;

export type StreamedSuggestionDto = z.infer<typeof StreamedSuggestionSchema>;

export type GenerateSuggestionRequestDto = z.infer<
    typeof GenerateSuggestionRequestSchema
>;

export type GenerateSuggestionResponseDto = z.infer<
    typeof GenerateSuggestionResponseSchema
>;



export type EnrichedSuggestionResponseDto = z.infer<
    typeof EnrichedSuggestionResponseSchema
>;
