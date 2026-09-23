import {
    DishPairingsRequestSchema,
    DishPairingsResponseSchema,
    type PairingCandidateDto,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import type { Request } from "express";

import { waiveQuota } from "../../../../middleware/require-quota";
import {
    type DishPairingSetRow,
    fetchDishPairingSet,
    fetchPairingCandidates,
    fetchPairingHoldings,
    generateDishPairings,
    loadSeedDish,
    moreCourses,
    PAIRING_COURSES,
    recordDishPairings,
    resolveDishKey,
    resolveProfileId,
    topUpCourses,
    type PairingCandidate,
} from "../../services";

const ROUTE_READ = "recipes.pairings";
const ROUTE_GENERATE = "recipes.pairings.generate";

/**
 * What the reader asked for, narrowed to what a pairing set can answer.
 *
 * `main` is dropped rather than refused: the client sends the slots that are
 * still OPEN, computed from the seed's own course tags, and a dish with no
 * course tag at all legitimately leaves `main` open. A pairing set is always
 * ABOUT a main, so a second one is a different dinner rather than a course —
 * see `PAIRING_COURSES`.
 */
const wantedCourses = (courseTypes: string[]): string[] => [
    ...new Set(
        courseTypes
            .map((course) => course.trim().toLowerCase())
            .filter((course) =>
                (PAIRING_COURSES as readonly string[]).includes(course)
            )
    ),
];

const toDto = (candidate: PairingCandidate): PairingCandidateDto => ({
    courseType: candidate.courseType,
    source: candidate.source,
    rank: candidate.rank,
    dishKey: candidate.dishKey,
    isRecipe: candidate.isRecipe,
    id: candidate.id,
    name: candidate.name,
    nameEn: candidate.nameEn,
    description: candidate.description,
    shortDescription: candidate.shortDescription,
    difficulty: candidate.difficulty,
    totalTimeMinutes: candidate.totalTimeMinutes,
    image: candidate.image,
    ingredients: candidate.ingredients,
    tags: candidate.tags,
});

/**
 * What goes with this dish — read only, and free.
 *
 * Two layers, both already computed elsewhere: dishes people actually served
 * with this one (`menu_pairings_for_recipe`, evidence) and dishes a model was
 * once asked to name for it (`dish_pairings`, a proposal). The whole request is
 * two indexed reads.
 *
 * ## Why this is not simply part of compose
 *
 * The compose picker has never been able to ask this question. It called
 * `find_recipes` with a course tag and the seed's cuisine, which is a FILTER
 * over the catalogue rather than a pairing — a Tuscan side was offered for a
 * Ribollita because both are Tuscan, and nothing in that query knew what the
 * main was. Meanwhile the evidence layer has run INSIDE `/compose` since
 * `20260822000001` and was service-role only, so the reader met it only after
 * committing to a paid stream. This is that layer, moved in front of the
 * decision.
 *
 * ## Free, declared rather than defaulted
 *
 * `allowFree` on the route. Metering the read would be wrong in a way that is
 * easy to miss: `requireQuota` checks the allowance at the door, so a reader
 * who had spent theirs would be answered 402 for a read that costs nothing, and
 * the compose sheet would stop opening for the people most likely to want it.
 * The generation that FILLS this cache is the sibling route below, and that one
 * is metered.
 */
export const readDishPairings = createStreamHandler({
    route: ROUTE_READ,
    requestSchema: DishPairingsRequestSchema,
    responseSchema: DishPairingsResponseSchema,

    handler: async ({ body, req }) => {
        const recipeId = (req as unknown as Request).params?.recipeId;
        const seed = await loadSeedDish(recipeId, req);

        if (seed.error) {
            return {
                type: "raw" as const,
                statusCode: seed.error.status,
                data: seed.error.body,
            };
        }

        const courses = wantedCourses(body.courseTypes);
        const mainDishKey = await resolveDishKey(seed.seed.id);

        const [set, candidates, holdings] = await Promise.all([
            fetchDishPairingSet(mainDishKey),
            // Asked for even when no set exists. The evidence layer needs no
            // generation at all, so a dish somebody has already composed around
            // offers its real pairings on the very first open — which is also
            // what stops the picker offering to generate for a dish that
            // already has good answers.
            fetchPairingCandidates({
                recipeId: seed.seed.id,
                courseTypes: courses,
                perCourse: body.perCourse,
                blacklist: body.blacklist,
                dietaryRestrictions: body.dietaryRestrictions,
                difficulty: body.difficulty ?? null,
                include: body.include,
            }),
            // Counts only — the names are a top-up's business and this runs on
            // every sheet open. One indexed select alongside the two above.
            fetchPairingHoldings(mainDishKey),
        ]);

        return {
            type: "raw" as const,
            statusCode: 200,
            data: {
                generated: set !== null,
                // Intersected with what the caller can still fill. The stored
                // answer is about the dish; the request is about this menu, and
                // a course the seed already occupies must not come back as one
                // to add.
                courses: (set?.courses ?? []).filter((course) =>
                    courses.includes(course)
                ),
                askedCourses: (set?.askedCourses ?? []).filter((course) =>
                    courses.includes(course),
                ),
                topUpCourses: topUpCourses({ set, holdings, courses }),
                // The BUTTON's set, and the wider of the two — see the schema.
                // Opening a course spends only on the first; asking for more
                // spends up to the ceiling the picker can draw.
                moreCourses: moreCourses({ set, holdings, courses }),
                generatedAt: set?.generatedAt ?? null,
                candidates: candidates.map(toDto),
            },
        };
    },
});

/**
 * How many cold generations one profile may start per day.
 *
 * A pairing set is written once and read by everybody, so the honest price is
 * "somebody has to go first" rather than a per-reader charge — but a request
 * that can spend a model call has to be bounded by something, and the quota on
 * the route is the wrong bound on its own: it counts recipes, and a reader who
 * has any allowance left could otherwise walk the catalogue generating sets for
 * dishes nobody is composing around.
 *
 * In-memory, and that is a real limitation: a Lambda that cold-starts forgets,
 * and several concurrent containers each hold their own count. It bounds the
 * pathological case — one client in a loop — rather than enforcing a policy. The
 * quota on the route is what actually charges; this is what stops one reader
 * turning their allowance into a crawl of the whole catalogue.
 */
const COLD_GENERATIONS_PER_DAY = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

const coldGenerations = new Map<string, { count: number; resetAt: number }>();

const mayGenerate = (profileId: string): boolean => {
    const now = Date.now();
    const seen = coldGenerations.get(profileId);

    if (!seen || seen.resetAt <= now) {
        coldGenerations.set(profileId, { count: 1, resetAt: now + DAY_MS });
        return true;
    }

    if (seen.count >= COLD_GENERATIONS_PER_DAY) return false;

    seen.count += 1;
    return true;
};

/**
 * Ask the model what goes with this dish, once, for everybody.
 *
 * Reached from a deliberate press in the picker — not from the sheet opening.
 * That distinction is the whole reason this is a second route: a model call
 * behind a screen appearing is a charge nobody made, and this app's rule is
 * that nothing is spent until a press.
 *
 * ## It is idempotent by cache, and the charge follows
 *
 * A set may have landed between the reader seeing the offer and pressing it —
 * somebody else composing around the same dish, or the warming operation
 * catching up. The generation is skipped and `waiveQuota` is called, so the
 * reader is not billed for a call that did not happen. The same rule `promote`
 * and `modify` follow for their reuse shortcuts, and for the same reason:
 * charging for a recipe we already had is the one thing that makes a quota feel
 * dishonest.
 */
export const generateDishPairingsForRecipe = createStreamHandler({
    route: ROUTE_GENERATE,
    requestSchema: DishPairingsRequestSchema,
    responseSchema: DishPairingsResponseSchema,

    handler: async ({ body, req }) => {
        const recipeId = (req as unknown as Request).params?.recipeId;
        const seed = await loadSeedDish(recipeId, req);

        if (seed.error) {
            // Nothing was generated, so nothing is owed. The middleware records
            // usage on a 2xx, and both of these are not — but waiving is free
            // and makes the rule "you pay for a model call" hold on every exit
            // rather than on the ones that happen to be errors.
            waiveQuota(req);

            return {
                type: "raw" as const,
                statusCode: seed.error.status,
                data: seed.error.body,
            };
        }

        const courses = wantedCourses(body.courseTypes);

        // Nothing a pairing set could answer. `wantedCourses` drops `main` and
        // anything outside the vocabulary, so a request naming only those
        // leaves nothing to fill — and generating anyway would spend a model
        // call on a set the caller has no slot for. Refused rather than served
        // empty, because an empty 200 here is indistinguishable from "this dish
        // is eaten alone", which is a claim this request has not earned.
        //
        // Not reachable from the app today (the client sends the slots the seed
        // leaves open, which can never be only `main`), and cheap to refuse.
        if (courses.length === 0) {
            waiveQuota(req);

            return {
                type: "raw" as const,
                statusCode: 400,
                data: {
                    error: "No pairable courses requested",
                    pairable: PAIRING_COURSES,
                },
            };
        }

        const mainDishKey = await resolveDishKey(seed.seed.id);

        const answer = async (
            generated: boolean,
            generatedAt: string | null,
            endorsed: string[],
            asked: string[],
            /**
             * The set as it now stands, for the third state.
             *
             * Taken as a parameter rather than re-read, because every caller
             * already holds it — and on the post-generation path it is the row
             * READ BACK after the write, which is the only copy that knows what
             * the run actually produced.
             */
            set: DishPairingSetRow | null,
        ) => {
            const [candidates, holdings] = await Promise.all([
                fetchPairingCandidates({
                    recipeId: seed.seed.id,
                    courseTypes: courses,
                    perCourse: body.perCourse,
                    blacklist: body.blacklist,
                    dietaryRestrictions: body.dietaryRestrictions,
                    difficulty: body.difficulty ?? null,
                    include: body.include,
                }),
                fetchPairingHoldings(mainDishKey),
            ]);

            return {
                type: "raw" as const,
                statusCode: 200,
                data: {
                    generated,
                    courses: endorsed.filter((course) => courses.includes(course)),
                    askedCourses: asked.filter((course) => courses.includes(course)),
                    topUpCourses: topUpCourses({ set, holdings, courses }),
                    moreCourses: moreCourses({ set, holdings, courses }),
                    generatedAt,
                    candidates: candidates.map(toDto),
                },
            };
        };

        const existing = await fetchDishPairingSet(mainDishKey);

        /**
         * Which courses this call should actually go and ask about.
         *
         * Empty means there is nothing left to do — every course the caller
         * named has already been solicited, whatever came back — and the press
         * costs nothing.
         *
         * `target` is what the READER pressed; it falls back to everything
         * requested, which is what a caller with no particular course in mind
         * (the warming operation) wants.
         */
        const target = wantedCourses(
            body.target?.length ? body.target : body.courseTypes,
        );

        const toFill = existing
            ? target.filter((course) => !existing.askedCourses.includes(course))
            : target;

        /**
         * What the set already holds, per course — counts AND names.
         *
         * The names are what a top-up excludes, so the second call cannot spend
         * itself re-naming the dishes the first found: `record_dish_pairings`
         * drops a repeat on the unique constraint, so without them the reader
         * pays and the course stays exactly as thin.
         */
        const holdings = existing
            ? await fetchPairingHoldings(mainDishKey, { withNames: true })
            : {};

        /**
         * Courses worth asking again — see `generatableCourses` for the four
         * tests, and `20260916000004` / `20260922000003` for why there is an
         * again at all.
         *
         * **`moreCourses`, not `topUpCourses`**, and the difference is the
         * whole of what makes the picker's button work. This route's question
         * is "would this press add anything", which is the WIDER rule: a reader
         * pressing "show me more" on a course holding three has asked for
         * something the narrower rule would waive, because that one is about
         * whether to spend on their behalf when they merely open a course. The
         * client decides WHICH press it is making; the route only has to be
         * permissive enough to honour it, and still refuses a course that is
         * full or out of budget.
         *
         * Narrowed to `target`, so it is still the reader's press that decides
         * which course is worked on. The warming operation names every course
         * and so refills every thin one, which is the right behaviour for it.
         */
        const toRefill = moreCourses({ set: existing, holdings, courses: target });

        const work = [...toFill, ...toRefill];

        // Somebody got here first, or every course the caller named is finished
        // — asked, and either full enough to be a choice or already given its
        // one extra call. Not an error and not a wasted press: the reader
        // wanted the ideas and the ideas are as good as they are going to get.
        if (existing && work.length === 0) {
            waiveQuota(req);

            return answer(
                true,
                existing.generatedAt,
                existing.courses,
                existing.askedCourses,
                existing,
            );
        }

        const profileId = await resolveProfileId(
            (req as unknown as Request).supabaseUserId
        );

        // No profile means `ALLOW_UNAUTHENTICATED`, or a user whose profile
        // insert never ran. Both are the caller's problem to report rather than
        // a reason to let an unattributable request spend a model call.
        if (!profileId) {
            waiveQuota(req);

            return {
                type: "raw" as const,
                statusCode: 403,
                data: { error: "No profile for the current user" },
            };
        }

        if (!mayGenerate(profileId)) {
            waiveQuota(req);

            return {
                type: "raw" as const,
                statusCode: 429,
                data: {
                    error: "Too many pairing sets generated today",
                    retryAfterHours: 24,
                },
            };
        }

        /**
         * TARGETED when a set already exists, untargeted when it does not.
         *
         * The first call asks the model what the dish wants and fills those
         * courses. A course it declined has not been asked for dishes, so
         * pressing it later lands here with a set in hand — and asking the
         * original prompt again would only get the same refusal, because its
         * first job is deciding whether the course belongs. The targeted branch
         * skips that decision and names dishes for the course outright.
         */
        const set = await generateDishPairings(seed.seed, {
            mainDishKey,
            // The course the reader pressed, on BOTH paths. On the first call
            // the model still chooses the shape of the meal but must address
            // this course regardless — without that, a dish it declines
            // wholesale answers the press with nothing and needs a second one
            // to trigger a targeted call.
            targetCourses: work,
            chooseCourses: !existing,
            // Only the courses being REFILLED contribute exclusions: a course
            // being asked for the first time holds nothing.
            excludeNames: toRefill.flatMap(
                (course) => holdings[course]?.names ?? []
            ),
        });

        // Written even when it holds nothing. An empty answer is a real one —
        // "this dish is eaten on its own", or "nothing honestly goes in that
        // course" — and recording WHICH COURSES WERE ASKED is what stops the
        // next press paying to be told the same thing.
        const stored = await recordDishPairings({
            mainDishKey,
            courses: set.courses,
            asked: set.asked,
            pairings: set.pairings,
            model: set.model,
            // A targeted run fills its course and leaves the rest: replacing
            // would throw away what the first call found.
            merge: !!existing,
            // Makes the write APPEND to these courses rather than clear them
            // first — a merge that cleared a course it was refilling would
            // delete the dishes it already had. It no longer BOUNDS anything;
            // `generation_attempts` does that, and the RPC raises it from
            // `p_asked` without being told. See `20260922000003`.
            toppedUp: toRefill,
        });

        if (!stored) {
            console.error(
                `[Pairings] generated ${set.pairings.length} for ${mainDishKey} but could not record them`
            );
        }

        console.log(
            `[Pairings] ${seed.seed.name}: ${existing ? `targeted [${toFill.join(", ")}]${toRefill.length ? ` refill [${toRefill.join(", ")}]` : ""}` : `endorsed [${set.courses.join(", ")}]`}, ${set.pairings.length} dishes`
        );

        // Read back rather than assembled here: a merge unions `asked_courses`
        // and preserves `courses`, so what this run produced is not what the
        // set now holds — and the client decides whether to generate again on
        // exactly that.
        const written = await fetchDishPairingSet(mainDishKey);

        return answer(
            stored,
            written?.generatedAt ?? new Date().toISOString(),
            written?.courses ?? set.courses,
            written?.askedCourses ?? set.asked,
            written,
        );
    },
});
