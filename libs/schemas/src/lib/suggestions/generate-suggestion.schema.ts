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
    /**
     * The SHAPE the user asked for — soup, salad, curry — as a plain tag name.
     *
     * Sent whenever the dish-form filter is set, including from the home screen's
     * "Soups"/"Salads" quick chips. Without it, a filtered search that exhausts
     * the catalogue generated unconstrained dishes: the tag id narrowed
     * `find_recipes` correctly, then the AI top-up that fires on an empty page
     * knew nothing about it and filled a soup feed with whatever it liked. That is
     * the same gap `quickDietaryTag` closes for dietary chips, which the client
     * has to hand the AI by NAME because the DB query only ever carried an id.
     *
     * A name, not an id, for that reason: the prompt cannot use a uuid. The client
     * holds `{ id, name }` in its filter store precisely so both halves are
     * available.
     */
    dishForm: z.string().optional(),
    /**
     * Dish names the client is ALREADY showing — earlier batches of an
     * infinite-scroll feed, plus whatever came from the database — so the next
     * batch stays novel.
     *
     * The client has always sent this (`useSuggestionFeed` builds it from every
     * committed batch). It was simply not declared here, and a zod object strips
     * what it does not declare, so it was discarded on arrival and every "generate
     * more" page was free to re-propose page one's dishes. The backend's own
     * `listCatalogDishes` does not cover it: that reads the catalogue, and the
     * client's list also includes dishes shown from sources the backend cannot
     * see.
     */
    exclude: z.array(z.string()).optional(),
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
    /**
     * The generator's estimate of how long the dish takes, start to plate.
     *
     * A suggestion is a card that exists BEFORE its recipe, so there is nothing
     * to derive this from — unlike a recipe, whose total is computed from the
     * prep and cook times it already stores. The client bands it rather than
     * printing it (`timeBandFor`), which is the whole reason an estimate is
     * acceptable here: it only has to land in the right third.
     *
     * Optional, with the same shape and for the same reason as
     * `InstructionSchema.durationSeconds` — the model occasionally writes it as
     * a string or omits it, and a required key would fail the WHOLE line, which
     * for JSONL means the dish is silently dropped rather than raised. A missing
     * estimate costs a card with no time pill; a required one costs the card.
     *
     * Note the operator order, which is load-bearing: `.optional()` OUTSIDE the
     * transform (a transform wrapping an optional yields `number | undefined` on
     * a still-REQUIRED key), and `.catch()` outside that.
     *
     * Non-positive and absurd values become undefined rather than being stored.
     * The upper bound is a week, which only rejects garbage — the overnight
     * exclusion in `DISH_TOTAL_TIME_RULE` is what keeps genuine long ferments
     * from arriving here as 12-hour totals in the first place.
     */
    total_time_minutes: z
        .preprocess(
            (value) => (value === null || value === "" ? undefined : value),
            z.coerce.number()
        )
        .transform((value) =>
            value > 0 && value <= 10080 ? Math.round(value) : undefined
        )
        .optional()
        .catch(undefined)
        .describe("Whole minutes from starting to cook until ready to eat"),
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
    /**
     * The stored estimate, read back from `recipe_suggestions.total_time_minutes`.
     *
     * Nullable rather than merely optional, because the column genuinely is:
     * rows written before the column existed carry no estimate and are not
     * backfilled. The client renders no time pill for a null — inventing a band
     * for it is exactly the fabricated cook time this replaced.
     */
    totalTimeMinutes: z.number().int().positive().nullable().optional(),
    ingredients: z.array(SuggestionIngredientSchema),
    tags: z.array(SuggestionTagSchema),
});

/**
 * A dish has been generated and is being checked — hold a slot for it.
 *
 * `/suggestions/generate` sends each suggestion twice: this frame the instant
 * the model finishes writing its line, then {@link StreamedSuggestionSchema}
 * once the dish has passed the notability gate and been persisted.
 *
 * It carries NOTHING about the dish, deliberately, and that is the whole point.
 * Because it says nothing, nothing it says can turn out to be wrong — the
 * client draws one placeholder per dish genuinely in flight, and a dish that is
 * renamed, deduped away or rejected simply takes its placeholder with it.
 *
 * It replaced a frame that carried the full card off the model's raw output.
 * That one was faster to something readable and wrong twice over: a third to a
 * half of dishes are renamed by the review, so cards visibly retitled
 * themselves; and dedup could resolve a dish to one already on screen, so cards
 * appeared and then vanished. Showing less, sooner, beat showing more, early.
 */
export const PendingSuggestionSchema = z.object({
    /** Matches the `tempId` on the enriched (or withdrawn) frame for this dish. */
    tempId: z.string(),
    pending: z.literal(true),
});

export type PendingSuggestionDto = z.infer<typeof PendingSuggestionSchema>;

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
 * Releases a pending slot that will never become a card.
 *
 * A dish can disappear after {@link PendingSuggestionSchema} has reserved its
 * place: the notability gate may reject it, or dedup may resolve it to
 * something the user already has. The placeholder is on screen by then, so
 * silence would leave it spinning forever.
 */
export const WithdrawnSuggestionSchema = z.object({
    tempId: z.string(),
    withdrawn: z.literal(true),
});

export type WithdrawnSuggestionDto = z.infer<typeof WithdrawnSuggestionSchema>;

/**
 * Terminal frame: the request itself is out of scope, so no card is coming.
 *
 * Distinct from a batch that merely came back empty. An empty batch means "we
 * found nothing this time" and a retry is reasonable; this means "we will never
 * answer this", and retrying spends money to withdraw the same cards again.
 *
 * It exists because withdrawal alone reads as a bug from the client's side. Ask
 * for "mojito" and four cards appear and then vanish, leaving a blank feed with
 * nothing to explain it — which is a worse experience than the drink recipes it
 * replaced. The client needs something to render, and `reason` is what it
 * renders.
 *
 * Carries no `tempId`: it is about the request, not about any one card. A client
 * keying frames by `tempId` must branch on `rejected` BEFORE it looks one up.
 */
export const RejectedSuggestionRequestSchema = z.object({
    rejected: z.literal(true),
    /**
     * Why, as a stable machine-readable code — never a sentence to display.
     *
     * The user-facing wording belongs in the client, where it can be localised
     * and matched to the surface it appears on. A message chosen here would ship
     * inside a packed tarball and could not be changed without rebuilding it.
     */
    reason: z.literal("not_food"),
});

export type RejectedSuggestionRequestDto = z.infer<
    typeof RejectedSuggestionRequestSchema
>;

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
