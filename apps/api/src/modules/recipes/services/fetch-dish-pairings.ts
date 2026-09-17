import { supabaseAdmin } from "@fridgeezy/supabase";

import { resolveIngredientIds, toNamedRows } from "./find-catalogue-recipes";

/**
 * One dish the compose picker may offer for a course.
 *
 * Shaped like `MenuPairing` on purpose — both feed the same cards — but with
 * `source` carried explicitly, because the client has to be able to tell a dish
 * somebody actually served alongside this one from a dish a model proposed.
 * That distinction is what the whole provenance rule rests on downstream.
 */
export interface PairingCandidate {
    courseType: string;
    /** `menu` = evidence from a saved menu, `proposed` = the model's opinion. */
    source: "menu" | "proposed" | "chosen";
    /** Position within its course. Evidence always ranks ahead of proposals. */
    rank: number;
    /** The family identity, so the client can dedup against what it holds. */
    dishKey: string;
    isRecipe: boolean;
    id: string;
    name: string;
    nameEn: string | null;
    description: string;
    shortDescription: string | null;
    difficulty: "easy" | "medium" | "hard";
    totalTimeMinutes: number | null;
    image: string | null;
    ingredients: Array<{ id: string; name: string }>;
    /**
     * `type` is what `RecipeCard`'s eyebrow is derived from — see
     * `groupRecipeTags`, which finds a cuisine and a dish form by nothing else.
     * Optional because a dish whose tags predate the RPC carrying it degrades
     * to the card it always drew: one with no eyebrow.
     */
    tags: Array<{ id: string; name: string; type?: string }>;
}

export interface DishPairingSetRow {
    /** Courses the model endorsed for this dish. Empty is a real answer. */
    courses: string[];
    /**
     * Courses we have actually solicited dishes for.
     *
     * What decides whether pressing a course generates. A course NOT in here
     * has never been asked about, however long the set has existed — which is
     * the whole reason it is a column of its own; see `20260916000001`.
     */
    askedCourses: string[];
    /**
     * Courses that have had their one extra generation.
     *
     * A course in here is finished whatever it holds — see
     * `20260916000004`. Read alongside `askedCourses`, which answers a
     * different question: asked once and short is a course worth topping up,
     * asked once and topped up is a course that is as good as it gets.
     */
    toppedUpCourses: string[];
    generatedAt: string;
    model: string | null;
}

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

/**
 * Values already reported, so one unknown level costs one line rather than one
 * per row per request. Same treatment `fetch-menu-pairings` gives it.
 */
const reportedUnknownDifficulties = new Set<string>();

const narrowDifficulty = (value: unknown): "easy" | "medium" | "hard" => {
    if (typeof value === "string" && DIFFICULTIES.has(value)) {
        return value as "easy" | "medium" | "hard";
    }

    if (
        typeof value === "string" &&
        value !== "" &&
        !reportedUnknownDifficulties.has(value)
    ) {
        reportedUnknownDifficulties.add(value);
        console.error(
            `[Pairings] unknown difficulty ${JSON.stringify(value)} — reporting it as "medium". ` +
                `The database knows a difficulty_type this build does not; redeploy the API.`
        );
    }

    return "medium";
};

/**
 * The dish's identity, as every menu read spells it.
 *
 * `coalesce(source_suggestion_id, id)` for a recipe. A recipe id that resolves
 * to nothing is returned unchanged, which is the same fallback the `target` CTE
 * inside `menu_pairings_for_recipe` applies — a caller may legitimately hand us
 * a suggestion id.
 *
 * Returned separately from the set because the WRITE path needs it too, and
 * having the read resolve it once is what keeps the two from disagreeing about
 * which row a set belongs to.
 */
export async function resolveDishKey(recipeId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("id, source_suggestion_id")
        .eq("id", recipeId)
        .maybeSingle();

    if (error) {
        console.error("[Pairings] dish key lookup failed:", error.message);
        return recipeId;
    }

    return data?.source_suggestion_id ?? data?.id ?? recipeId;
}

/**
 * Has anybody asked what goes with this dish?
 *
 * Null means nobody has. An empty `courses` means somebody did and the answer
 * was "nothing" — which is a real answer about a one-pot stew, and the reason
 * `dish_pairing_sets` exists as a table of its own rather than being derived
 * from whether `dish_pairings` holds any rows. The picker draws those two
 * states completely differently: one offers to go and find out, the other says
 * this dish is eaten on its own.
 */
export async function fetchDishPairingSet(
    mainDishKey: string
): Promise<DishPairingSetRow | null> {
    const { data, error } = await supabaseAdmin
        .from("dish_pairing_sets")
        .select("courses, asked_courses, topped_up_courses, generated_at, model")
        .eq("main_dish_key", mainDishKey)
        .maybeSingle();

    if (error) {
        console.error("[Pairings] set lookup failed:", error.message);
        return null;
    }

    if (!data) return null;

    return {
        courses: data.courses ?? [],
        askedCourses: data.asked_courses ?? [],
        toppedUpCourses: data.topped_up_courses ?? [],
        generatedAt: data.generated_at,
        model: data.model ?? null,
    };
}

/**
 * What each course of a set already HOLDS — the count, and the dish names.
 *
 * Two things the API cannot get from `fetchPairingCandidates`, and needs both:
 *
 * - The COUNT is reader-independent, where that function's result is filtered
 *   by the caller's blacklist and diet. A course holding six dishes of which a
 *   vegan reader can eat one is not a thin course, and topping it up would grow
 *   a SHARED set on one reader's behalf with dishes the model was never told to
 *   avoid. So thinness is judged on the set, not on the view of it.
 * - The NAMES are what a top-up excludes, so the second call cannot spend
 *   itself re-naming what the first found.
 *
 * Reads through `recipe_suggestions` and `recipes` because a `dish_key` is
 * `coalesce(source_suggestion_id, id)` and a pairing may point at either.
 */
export async function fetchPairingHoldings(
    mainDishKey: string,
    options: { withNames?: boolean } = {}
): Promise<Record<string, { count: number; names: string[] }>> {
    const { data, error } = await supabaseAdmin
        .from("dish_pairings")
        .select("course_type, dish_key")
        .eq("main_dish_key", mainDishKey);

    if (error) {
        console.error("[Pairings] holdings lookup failed:", error.message);
        return {};
    }

    const rows = data ?? [];

    if (rows.length === 0) return {};

    // The READ path wants counts alone and is on every sheet open, so the two
    // name lookups are opt-in. Only a top-up needs the names, and only for the
    // courses it is about to ask again.
    if (!options.withNames) {
        const counts: Record<string, { count: number; names: string[] }> = {};

        for (const row of rows) {
            const bucket = (counts[row.course_type as string] ??= {
                count: 0,
                names: [],
            });

            bucket.count += 1;
        }

        return counts;
    }

    const keys = [...new Set(rows.map((row) => row.dish_key as string))];

    const [suggestions, recipes] = await Promise.all([
        supabaseAdmin.from("recipe_suggestions").select("id, name").in("id", keys),
        supabaseAdmin.from("recipes").select("id, name").in("id", keys),
    ]);

    const nameByKey = new Map<string, string>();

    for (const row of suggestions.data ?? []) {
        if (row.name) nameByKey.set(row.id as string, row.name as string);
    }

    // Recipes second and deliberately: a promoted dish exists in both, and the
    // recipe's name is the one the reader is shown.
    for (const row of recipes.data ?? []) {
        if (row.name) nameByKey.set(row.id as string, row.name as string);
    }

    const holdings: Record<string, { count: number; names: string[] }> = {};

    for (const row of rows) {
        const course = row.course_type as string;
        const bucket = (holdings[course] ??= { count: 0, names: [] });

        bucket.count += 1;

        const name = nameByKey.get(row.dish_key as string);
        if (name) bucket.names.push(name);
    }

    return holdings;
}

/**
 * Below this, a course is worth asking about a second time.
 *
 * Three, and it is the SAME number as the client's `PAIRING_FLOOR` on purpose:
 * that is the count below which the picker stops presenting a course as a
 * choice and draws its search field instead. A course the picker will not
 * present is exactly the course worth one more call, and two numbers here would
 * drift into a press that generates for a course the reader was never shown a
 * problem with — or, worse, an offer that always waives.
 *
 * It is a FLOOR on the set, not on what a reader can see: `fetchPairingHoldings`
 * counts the stored rows, where `fetchPairingCandidates` returns the caller's
 * filtered view. A course holding six dishes of which one reader can eat one is
 * not thin — and topping it up would grow a SHARED set on their behalf with
 * dishes the model was never told to avoid, so the next reader pays for their
 * diet.
 */
export const PAIRING_TOP_UP_BELOW = 3;

/**
 * Which courses one more generation would actually help.
 *
 * Read by BOTH pairing routes, and that is the whole reason it is a function:
 * the picker decides whether to offer the press and the endpoint decides
 * whether to spend on it, so a client-side copy of this rule is a press that
 * charges nothing and changes nothing — or an offer the reader never sees for a
 * course stuck at one dish.
 *
 * Four tests, and each excludes a different mistake:
 *
 * - **Asked** — a course never solicited is not a top-up, it is the first call.
 * - **Not already topped up** — the bound. One extra call per course, ever, so
 *   a dish with one honest pairing costs two calls across its life rather than
 *   one per press.
 * - **Thin** — at or above the floor there is a choice already.
 * - **Endorsed OR holding something** — the one that needed a second look.
 *
 * That last test started as `endorsed` alone, to stop a course the model
 * DECLINED being re-asked: absent from `courses` means nothing honestly goes
 * there, and asking again buys the same refusal. But a declined course can
 * still be FILLED — the reader presses it, a targeted call names dishes for it,
 * and `p_merge` deliberately leaves `courses` alone so a reader's override
 * never rewrites the model's opinion. So a course the model declined, the
 * reader asked for, and one dish came back for was permanently stuck at one:
 * exactly the dead end this whole third state exists to remove, reached from
 * the other side.
 *
 * Holding at least one dish is the evidence that something does go there,
 * whatever the model said first. What is still excluded is the genuinely
 * exhausted case — asked, not endorsed, and nothing came back — where two
 * different calls have now said there is nothing to serve.
 */
export const topUpCourses = (params: {
    set: DishPairingSetRow | null;
    holdings: Record<string, { count: number }>;
    /** Narrowed to the courses the caller asked about. */
    courses: string[];
}): string[] => {
    const { set, holdings, courses } = params;

    if (!set) return [];

    return courses.filter((course) => {
        const held = holdings[course]?.count ?? 0;

        return (
            set.askedCourses.includes(course) &&
            !set.toppedUpCourses.includes(course) &&
            held < PAIRING_TOP_UP_BELOW &&
            (set.courses.includes(course) || held > 0)
        );
    });
};

export interface FetchPairingCandidatesOptions {
    recipeId: string;
    courseTypes: string[];
    perCourse: number;
    blacklist: string[];
    dietaryRestrictions: string[];
    /** Orders the result; never narrows it. */
    difficulty?: string | null;
    /**
     * Dishes the caller has already picked, returned resolved as `chosen`.
     *
     * Exempt from the two filters above — see the request schema's own note and
     * the `included` CTE in `20260916000001`.
     */
    include?: Array<{ courseType: string; dishId: string }>;
}

/**
 * What goes with this dish, both layers, filtered for this reader.
 *
 * `pairing_candidates_for_recipe` does the work: saved-menu evidence first, the
 * model's proposals behind it, deduped across the two and cut per course. This
 * is the transport.
 *
 * NEVER THROWS. An empty list is a picker showing its search field, which is a
 * working screen — where a thrown error would take out the compose sheet for a
 * reader whose blacklist merely happened to empty a course. Same contract, and
 * the same reason, as `fetchMenuPairings` beside it.
 *
 * Reads as the SERVICE ROLE and therefore past RLS. The function it calls is
 * SECURITY DEFINER and embeds `menu_pairings_for_recipe`, which restates the
 * menu visibility rule itself — do not "simplify" either into a SECURITY
 * INVOKER read, which would either hand back private menus or, granted to
 * clients, hand every caller a door past the wall that function sits behind.
 */
export async function fetchPairingCandidates(
    options: FetchPairingCandidatesOptions
): Promise<PairingCandidate[]> {
    const {
        recipeId,
        courseTypes,
        perCourse,
        blacklist,
        dietaryRestrictions,
        difficulty,
        include = [],
    } = options;

    if (courseTypes.length === 0) return [];

    try {
        // Ids, because the SQL matches `recipe_ingredients.ingredient_id`. A
        // name that resolves to nothing is DROPPED — the same known weakness
        // `fetchMenuPairings` documents, and the reason compose re-checks with
        // `compileBlacklist` afterwards. There is no second check here because
        // nothing is generated on this path: the worst case is a dish the
        // reader has to decline, not one written for them.
        const blacklistIds = blacklist.length
            ? await resolveIngredientIds(blacklist)
            : [];

        const { data, error } = await supabaseAdmin.rpc(
            "pairing_candidates_for_recipe",
            {
                p_recipe_id: recipeId,
                p_course_types: courseTypes,
                p_per_course: perCourse,
                p_blacklist: blacklistIds,
                p_dietary: dietaryRestrictions,
                ...(difficulty ? { p_difficulty: difficulty } : {}),
                p_include: include.map((entry) => ({
                    course_type: entry.courseType,
                    dish_id: entry.dishId,
                })),
            }
        );

        if (error) {
            console.error(
                "[Pairings] pairing_candidates_for_recipe failed:",
                error.message
            );
            return [];
        }

        return (data ?? []).map((row) => ({
            courseType: row.course_type,
            source:
                row.source === "menu"
                    ? ("menu" as const)
                    : row.source === "chosen"
                      ? ("chosen" as const)
                      : ("proposed" as const),
            rank: row.pair_rank ?? 0,
            dishKey: row.dish_key,
            isRecipe: row.is_recipe,
            id: row.dish_id,
            name: row.name,
            nameEn: row.name_en ?? null,
            description: row.description ?? "",
            shortDescription: row.short_description ?? null,
            difficulty: narrowDifficulty(row.difficulty),
            totalTimeMinutes: row.total_time_minutes ?? null,
            image: row.image ?? null,
            ingredients: toNamedRows(row.ingredients),
            tags: toNamedRows(row.tags),
        }));
    } catch (error) {
        console.error("[Pairings] lookup failed:", error);
        return [];
    }
}

/**
 * Store a freshly generated set, replacing whatever was there.
 *
 * One statement, because the three it replaces are not safe apart — see
 * `record_dish_pairings` in `20260916000001`. Returns false rather than
 * throwing: the reader is holding a finished answer either way, and losing the
 * cache write costs the NEXT reader a generation rather than costing this one
 * their screen.
 */
export async function recordDishPairings(params: {
    mainDishKey: string;
    courses: string[];
    /** The courses this run solicited dishes for. */
    asked: string[];
    pairings: Array<{ courseType: string; dishKey: string; rank: number }>;
    model: string;
    /**
     * Fill the asked courses and leave the rest.
     *
     * True for a TARGETED run, which must not throw away the dishes an earlier
     * untargeted one found, nor overwrite the model's endorsement with a
     * reader's override.
     */
    merge?: boolean;
    /**
     * Courses this run is TOPPING UP.
     *
     * Recorded so the course cannot be asked a third time, and — the half that
     * would be a silent bug if it were dropped — it is what makes the write
     * APPEND for those courses instead of clearing them first. A merge that
     * cleared a course it was topping up would delete the one dish it had. See
     * `20260916000004`.
     */
    toppedUp?: string[];
}): Promise<boolean> {
    const { error } = await supabaseAdmin.rpc(
        "record_dish_pairings",
        {
            p_main_dish_key: params.mainDishKey,
            p_courses: params.courses,
            p_pairings: params.pairings.map((pairing) => ({
                course_type: pairing.courseType,
                dish_key: pairing.dishKey,
                rank: pairing.rank,
            })),
            p_model: params.model,
            p_asked: params.asked,
            p_merge: params.merge ?? false,
            p_topped_up: params.toppedUp ?? [],
        }
    );

    if (error) {
        console.error("[Pairings] record failed:", error.message);
        return false;
    }

    return true;
}
