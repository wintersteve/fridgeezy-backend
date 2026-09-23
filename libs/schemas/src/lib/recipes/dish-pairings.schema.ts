import { z } from "zod/v4";

/**
 * What goes with a dish, and how many of it there is.
 *
 * Two endpoints share this file because they return the SAME shape and only
 * differ in what they are allowed to do to produce it:
 *
 *   POST /recipes/:recipeId/pairings          — read the cache. Never runs a
 *                                               model, never charges.
 *   POST /recipes/:recipeId/pairings/generate — ask the model once, write the
 *                                               cache, return the same thing.
 *
 * Splitting them is not tidiness. `requireQuota` checks the allowance at the
 * door, before the handler runs, so a single metered endpoint would answer 402
 * to a reader with a spent allowance — for a read that costs nothing. The
 * compose sheet would stop opening for exactly the people who have used it
 * most.
 */

/**
 * Where a candidate came from, which is the whole of the provenance rule.
 *
 * `menu` — somebody put this dish on a plate with the main and kept the meal.
 * `proposed` — a model was asked what goes with the main and named this.
 * `chosen` — the CALLER already picked this one and sent it in `include`. Not
 *   a pairing at all: it is echoed back resolved, so a screen holding only an
 *   id can draw the dish.
 *
 * The client carries the answer through the composer and back into
 * `record_menu`: a menu whose every course is one of the first two is filed in
 * the shared corpus, and one holding a `chosen` course — anything the reader
 * found by searching — is filed under the reader. See migration
 * `20260916000002`.
 */
export const PairingSourceSchema = z.enum(["menu", "proposed", "chosen"]);
export type PairingSource = z.infer<typeof PairingSourceSchema>;

/** One dish offered for one course. */
export const PairingCandidateDtoSchema = z.object({
    /** The slot it is offered FOR, never the dish's own course tag. */
    courseType: z.string(),
    source: PairingSourceSchema,
    /** Position within its course; evidence always ranks ahead of proposals. */
    rank: z.number().int(),
    /**
     * The family identity — `coalesce(source_suggestion_id, id)`.
     *
     * Distinct from `id` and both are needed: `id` is the row to OPEN, which
     * changes when a suggestion is promoted, while this is what the dish IS and
     * never changes. The client dedups on this and writes `id`.
     */
    dishKey: z.string(),
    /** True when `id` names a `recipes` row, false for a suggestion. */
    isRecipe: z.boolean(),
    id: z.string(),
    name: z.string(),
    nameEn: z.string().nullable(),
    description: z.string(),
    shortDescription: z.string().nullable(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    totalTimeMinutes: z.number().nullable(),
    image: z.string().nullable(),
    ingredients: z.array(z.object({ id: z.string(), name: z.string() })),
    /**
     * `type` is the tag's kind — `cuisine`, `dish_form`, `course`, `dietary`,
     * `component` — and it is what the card's EYEBROW is derived from.
     *
     * Optional, and it was absent entirely until 2026-09-16: the two pairing
     * RPCs aggregated `{id, name}` only, so `groupRecipeTags` found no cuisine
     * and no dish form and every card drawn from a pairing was the one kind of
     * horizontal card in the app with no "ITALIAN · PASTA" line above its name.
     * Silent, because that is also what a dish with no tags looks like.
     */
    tags: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            type: z.string().optional(),
        })
    ),
});

export type PairingCandidateDto = z.infer<typeof PairingCandidateDtoSchema>;

export const DishPairingsRequestSchema = z.object({
    /**
     * Course slots to consider, from the course vocabulary exactly:
     * "appetizer", "side", "dessert". Nothing else resolves.
     *
     * The caller sends what is still OPEN — the seed already fills `main`, and
     * a dish that is itself a dessert has no dessert slot to fill. The endpoint
     * intersects this with what the model endorsed, so asking for a course this
     * dish does not want returns nothing for it rather than an error.
     */
    courseTypes: z
        .array(z.string().min(1))
        .min(1)
        .describe('Open course slots: "appetizer", "side", "dessert"'),
    /**
     * How many candidates per course. The picker shows six.
     */
    perCourse: z.number().int().positive().max(12).default(6),
    /**
     * Ingredients the reader will not eat.
     *
     * Applied on the READ and never sent to the model: a pairing set is shared,
     * so baking one reader's constraints into it would make the cache
     * per-reader and collapse the hit rate to nothing.
     */
    blacklist: z.array(z.string()).default([]),
    /** Dietary tags every candidate must satisfy. Also read-time only. */
    dietaryRestrictions: z.array(z.string()).default([]),
    /** Orders the candidates; never narrows them. */
    difficulty: z.enum(["easy", "medium", "hard"]).nullish(),
    /**
     * Dishes the caller has ALREADY CHOSEN, resolved and returned whatever the
     * pairing layer thinks of them.
     *
     * For a screen that holds a pick as a bare id and needs the dish: the
     * composer, which receives `pick=<slot>:<id>:<provenance>` on its route.
     * A dish found through the picker's unscoped search is by construction one
     * no pairing named, so without this the composer cannot see its own pick —
     * it falls back to the proposals and either puts a DIFFERENT dish on the
     * menu or counts the slot unfilled and pays the model to write one.
     *
     * Resolved in the same request rather than a second one because the compose
     * enqueue is gated on a single readiness flag: a pick that resolved later
     * would change the generation counts and mint a second paid job id.
     *
     * Exempt from `blacklist` and `dietaryRestrictions` — the reader chose it,
     * and dropping it would substitute a dish they did not choose, which is the
     * failure this exists to end.
     */
    include: z
        .array(
            z.object({
                courseType: z.string().min(1),
                dishId: z.string().min(1),
            }),
        )
        .default([])
        .describe("Dishes already picked, to resolve and return as `chosen`"),
    /**
     * The course the reader actually pressed — what a generation should FILL.
     *
     * Only read by `/pairings/generate`. It is separate from `courseTypes`,
     * which says what to RETURN, because the two differ: pressing Appetizer
     * should fill the appetizer and still come back with the sides and desserts
     * the sheet is already showing.
     *
     * Empty falls back to `courseTypes`, which is what a caller with no
     * particular course in mind wants — the warming operation.
     */
    target: z
        .array(z.string().min(1))
        .default([])
        .describe("Courses a generation should fill; defaults to courseTypes"),
});

export const DishPairingsResponseSchema = z.object({
    /**
     * Has anybody ever asked what goes with this dish?
     *
     * False means the model has not been asked, which is what the picker offers
     * to do. It is NOT the same as an empty `courses`, and conflating the two
     * is the failure this field exists to prevent — a dish eaten on its own and
     * a dish nobody has looked at would otherwise render identically, so the
     * sheet would either invite a generation that is guaranteed to return
     * nothing, or claim an absence it has not established.
     */
    generated: z.boolean(),
    /**
     * Which courses are worth serving with this dish, as the model judged it.
     *
     * Empty with `generated: true` is a real answer: some dishes are eaten
     * alone. The picker draws the endorsed rows and puts the rest behind one
     * line — the model shapes the default, it does not refuse the reader.
     */
    courses: z.array(z.string()),
    /**
     * Which courses have been SOLICITED, whatever came back.
     *
     * What a client decides to generate on, and distinct from `courses` — that
     * is the model's opinion about what the dish wants, this is what has
     * actually been asked. A course absent from here has never been asked
     * about however long the set has existed, so pressing it is worth a call;
     * one present with no candidates has been asked and found nothing, so
     * pressing it again would buy the same answer twice.
     *
     * Conflating the two is what made a course the model declined a permanent
     * dead end — see migration `20260916000001`.
     */
    askedCourses: z.array(z.string()),
    /**
     * Courses one MORE generation would actually help — the third state.
     *
     * `askedCourses` is two-valued and had to be: asked once, never again, so a
     * course the model declined is not re-asked on every press. What that also
     * caught is a course the model ENDORSED and then under-filled — the model
     * names fewer than it was asked for, dedup resolves two of its names onto
     * one row, the notability gate refuses others — so a course asked for six
     * dishes can arrive holding one, and no press could ever improve it.
     *
     * A course in here has been asked, was endorsed, has not had its one extra
     * call, and is below the floor that makes it a choice. **Computed
     * server-side and not derivable on the client**, which is the point of
     * sending it: thinness is judged on the stored set, where the client only
     * sees its own filtered view of it. A reader whose diet thins a full course
     * to one dish must not be offered a generation that would grow a shared set
     * on their behalf — and must not be offered one that silently waives.
     *
     * Empty is the ordinary answer. See migration `20260916000004`.
     */
    topUpCourses: z.array(z.string()),
    /**
     * Courses a deliberate "show me more" would add something to.
     *
     * The picker's button, and a SUPERSET of `topUpCourses` — same rule, with
     * room measured against what the picker can draw (six) rather than against
     * what makes a course a choice at all (two). The two are separate fields
     * because they govern two different presses: `topUpCourses` is spent on the
     * reader's behalf when they merely OPEN a thin course, this is spent when
     * they ask for more. Collapsing them would charge for opening any course
     * holding fewer than six.
     *
     * Empty means the button is not drawn — the course is full, or its
     * generation budget is spent, or nothing honestly goes there. **Not
     * derivable on the client**, for the reason `topUpCourses` gives at length:
     * both the holdings and the budget are properties of the stored set, and a
     * client only ever sees its own filtered view of it. A reader whose diet
     * thins a full course to one dish must not be offered a press that would
     * grow a shared set on their behalf — and must not be offered one that
     * silently waives.
     *
     * See migration `20260922000003`.
     */
    moreCourses: z.array(z.string()),
    /** When the set was generated. Null when it never was. */
    generatedAt: z.string().nullable(),
    /**
     * The candidates themselves, best first within each course.
     *
     * Present even when `generated` is false: the evidence layer needs no
     * generation at all, so a dish somebody has already composed around offers
     * its real pairings immediately.
     */
    candidates: z.array(PairingCandidateDtoSchema),
});

export type DishPairingsResponseDto = z.infer<
    typeof DishPairingsResponseSchema
>;
