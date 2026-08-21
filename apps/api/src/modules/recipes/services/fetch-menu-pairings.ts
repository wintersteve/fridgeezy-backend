import { supabaseAdmin } from "@fridgeezy/supabase";

import { resolveIngredientIds, toNamedRows } from "./find-catalogue-recipes";

/** A dish other people have already put on a plate with the base recipe. */
export interface MenuPairing {
    /** The slot it filled in those menus — one of the caller's `courseTypes`. */
    courseType: string;
    /**
     * What `save_menu` will compute for this dish, and therefore the identity
     * the composition must dedup on.
     *
     * NOT the same as `id`. The same dish is a suggestion row in the menu
     * somebody composed last month and a promoted recipe row in the one composed
     * today; `dish_key` is the only thing that says those are one dish.
     */
    dishKey: string;
    /** True when `id` is a `recipes` row, false when it is a suggestion. */
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
    tags: Array<{ id: string; name: string }>;
    /** The menus this pairing was found in — see `borrowMenuTitle`. */
    menuIds: string[];
    /** How many saved meals hold this pairing. The ranking signal. */
    pairSaves: number;
}

export interface FetchMenuPairingsOptions {
    /** The dish being composed around. */
    recipeId: string;
    courseTypes: string[];
    /** Candidates per slot. Ask for more than you need — see the caller. */
    perCourse: number;
    /** Dish names the caller has already been offered. */
    exclude: string[];
    /** Dish keys this composition has already committed to. */
    excludeKeys: string[];
    blacklist: string[];
    dietaryRestrictions: string[];
    /** Orders the result; never narrows it. */
    difficulty?: string | null;
}

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

/**
 * Values already reported, so one unknown level costs one line rather than one
 * per row per compose.
 */
const reportedUnknownDifficulties = new Set<string>();

/**
 * Narrow the function's `text` difficulty back to the enum, reporting anything
 * it does not recognise.
 *
 * The fallback stays `"medium"` because the frame this feeds is validated
 * against a `z.enum(["easy","medium","hard"])` in the wire schema — widening it
 * to null is a client contract change, not a local fix.
 *
 * **The logging is the point.** This is the seam a new `difficulty_type` value
 * arrives through: the enum widens in the database, the deployed API does not
 * know the value yet, and every pairing at the new level would quietly report
 * as `medium` — correct-looking output, wrong dish, nothing raised. A dish
 * whose difficulty is genuinely absent is a different case and is not reported;
 * only a value that IS set and IS unrecognised means the API is behind the
 * schema.
 */
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
            `[MenuPairings] unknown difficulty ${JSON.stringify(value)} — reporting it as "medium". ` +
                `The database knows a difficulty_type this build does not; redeploy the API.`
        );
    }

    return "medium";
};

/**
 * What people have already paired with this dish.
 *
 * The retrieval half of compose: before asking a model for an appetizer to go
 * with a main, ask the menus somebody actually saved. `20260822000001` holds the
 * ranking and every filter — the narrowing has to happen in SQL, before the
 * per-slot cut, or a long `exclude` list on the third re-roll silently costs the
 * recall it most needs.
 *
 * NEVER THROWS. An empty list means the caller generates, which is precisely
 * what compose did before this existed — so a retrieval failure costs tokens
 * rather than the composition. Same contract, and the same reason, as
 * `findCatalogueRecipes` beside it.
 *
 * Note this reads as the SERVICE ROLE and therefore past RLS. The function it
 * calls restates the visibility rule itself for exactly that reason; do not
 * "simplify" it into one of the SECURITY INVOKER menu RPCs, which would hand
 * back private menus to this caller.
 */
export async function fetchMenuPairings(
    options: FetchMenuPairingsOptions
): Promise<MenuPairing[]> {
    const {
        recipeId,
        courseTypes,
        perCourse,
        exclude,
        excludeKeys,
        blacklist,
        dietaryRestrictions,
        difficulty,
    } = options;

    if (courseTypes.length === 0) return [];

    try {
        // Ids, because the SQL filter matches `recipe_ingredients.ingredient_id`
        // — the same resolution `findCatalogueRecipes` does for `find_recipes`.
        // A name that resolves to nothing is DROPPED, which is why the caller
        // also runs `compileBlacklist` over the result: that one canonicalises
        // the user's raw string and has no resolution step to fail.
        const blacklistIds = blacklist.length
            ? await resolveIngredientIds(blacklist)
            : [];

        const { data, error } = await supabaseAdmin.rpc(
            "menu_pairings_for_recipe",
            {
                p_recipe_id: recipeId,
                p_course_types: courseTypes,
                p_per_course: perCourse,
                p_exclude_names: exclude,
                p_exclude_keys: excludeKeys,
                p_blacklist: blacklistIds,
                p_dietary: dietaryRestrictions,
                ...(difficulty ? { p_difficulty: difficulty } : {}),
            }
        );

        if (error) {
            console.error(
                "[MenuPairings] menu_pairings_for_recipe failed:",
                error.message
            );
            return [];
        }

        return (data ?? []).map((row) => ({
            courseType: row.course_type,
            dishKey: row.dish_key,
            isRecipe: row.is_recipe,
            id: row.dish_id,
            name: row.name,
            nameEn: row.name_en ?? null,
            description: row.description ?? "",
            shortDescription: row.short_description ?? null,
            // The column is `text` on the way out because the two source tables
            // spell it with the same enum but the union widens it.
            difficulty: narrowDifficulty(row.difficulty),
            totalTimeMinutes: row.total_time_minutes ?? null,
            image: row.image ?? null,
            ingredients: toNamedRows(row.ingredients),
            tags: toNamedRows(row.tags),
            menuIds: row.menu_ids ?? [],
            pairSaves: row.pair_saves ?? 0,
        }));
    } catch (error) {
        console.error("[MenuPairings] lookup failed:", error);
        return [];
    }
}
