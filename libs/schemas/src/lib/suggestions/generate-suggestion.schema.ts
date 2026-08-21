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
 * Tag with ID, name and type.
 *
 * `type` is what lets a card draw the same "CUISINE · KIND" eyebrow the recipe
 * card draws — the client singles the cuisine and dish-form tags out by type
 * rather than by name-matching. `find_recipes` has returned it on both its
 * recipe and its suggestion rows since `20260812000001`, so without it here a
 * streamed suggestion was the ONE card in the feed that could not draw one.
 *
 * Tolerated rather than required: it is read straight off `tags.type`, so the
 * only way it can fail to parse is a new `tag_type` value the enum here has not
 * been taught. That costs an eyebrow; a hard failure would cost the whole
 * frame, and with it the card.
 */
export const SuggestionTagSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z
        .enum(["dietary", "component", "course", "cuisine", "dish_form"])
        .optional()
        .catch(undefined),
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
 * How many cards this batch is going to show.
 *
 * ONE frame for the whole batch, re-sent whenever the number changes — not one
 * frame per dish. A slot is ANONYMOUS: it says "a card is coming", never which
 * dish, so the client renders `slots - cards.length` skeletons after the cards
 * it already has and nothing on screen is ever tied to a dish that might not
 * survive.
 *
 * ## Why this replaced the per-dish placeholder
 *
 * The frame this supersedes (`PendingSuggestionSchema`) was sent the instant
 * the model wrote a dish's name — before the notability gate, before dedup — so
 * a placeholder meant "the generator typed something", not "a card is coming".
 * Every internal retry then leaked onto the screen: four placeholders appeared
 * as the lines were parsed, two vanished when the gate dropped them as
 * `obscure`, and two more appeared when the top-up pass refilled the slots. The
 * user watched the pipeline work.
 *
 * A slot is only counted once its dish has cleared the gate AND every dedup
 * layer — see `onAdmit` in `persist-or-reuse-suggestion.ts` — which is the
 * earliest moment a card is certain. So the count grows and the skeletons fill
 * in; it does not churn.
 *
 * ## `verified` is what the interstitial waits on
 *
 * `false` means dishes are still being judged, so this is a running total and a
 * low number may only mean the first dish got through. `true` means the
 * generator's first pass has been judged in full, and the count is now worth
 * drawing.
 *
 * It is a LATCH: it flips false -> true once and never back, even though a
 * top-up pass may raise `slots` afterwards. That is the distinction it exists
 * to draw — "this count is trustworthy" is not "this count is final", and only
 * the first is a question the loading screen can act on. Latching is what keeps
 * a batch that admitted nothing on its first pass from dropping back into the
 * interstitial when the top-up starts.
 *
 * The client holds its searching interstitial until the first `verified: true`
 * (or a local timeout, for the occasional multi-second gate call), so it leaves
 * the loading screen already knowing how many skeletons to draw.
 *
 * ## While a top-up is running, it is an AIM rather than a tally
 *
 * A pass that admits one dish of four leaves the batch three short, and the
 * backend immediately asks the model for three more. Across that gap `slots`
 * reports the four the batch is still working towards, not the one it holds —
 * otherwise the client would drop its skeletons and sit on a one-card list for
 * the seconds that pass takes. The final frame reports what was actually
 * delivered, so a top-up that comes up short costs ONE downward correction at
 * the end of the stream instead of a list that empties and refills.
 *
 * The other case it can decrease in: a dish is admitted just before it is
 * persisted, so a hard persist failure leaves a slot with no card behind it and
 * a lower `slots` gives it back. Both are single, late corrections, which is
 * why this is not typed as monotonic — and both are a different thing from the
 * churn the per-dish placeholder produced, where rows appeared and vanished
 * throughout.
 */
export const SuggestionSlotsSchema = z.object({
    /**
     * Cards this batch will deliver, including those already sent — or, while a
     * top-up pass is running, the number it is still aiming for.
     */
    slots: z.number().int().nonnegative(),
    /** The first pass has been judged in full, so this count is worth drawing. */
    verified: z.boolean(),
});

export type SuggestionSlotsDto = z.infer<typeof SuggestionSlotsSchema>;

/**
 * The persisted card. Fills one of the slots {@link SuggestionSlotsSchema}
 * announced, and is the ONLY frame this endpoint sends that carries a dish.
 *
 * Cards arrive in generation order and each one is final — there is no earlier
 * frame for it to correct, so a client appends by `tempId` rather than
 * upgrading a placeholder in place. `tempId` is still carried because it is the
 * stable React key for the row and the id under which a card can be reconciled
 * if it is ever re-sent.
 *
 * Separate from {@link EnrichedSuggestionResponseSchema} so that type stays the
 * shape of a persisted suggestion everywhere else in the app, with no `tempId`
 * for callers that never stream.
 */
export const StreamedSuggestionSchema = EnrichedSuggestionResponseSchema.extend({
    tempId: z.string(),
    /**
     * Carried on the card rather than read back from the database —
     * the row has no such column, deliberately (@see
     * GenerateSuggestionResponseSchema.adaptedFor).
     */
    adaptedFor: z.array(z.string()).optional(),
});

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

export type SuggestionTagDto = z.infer<typeof SuggestionTagSchema>;
