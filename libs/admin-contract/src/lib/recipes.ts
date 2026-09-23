import { z } from "zod/v4";

import { FlagSchema, PageRequestSchema, SortDirectionSchema } from "./common";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/**
 * Narrowed rather than `string`, and it earns that: the console's level field
 * writes back through `AdminRecipeUpdate`, which takes the enum — so a row
 * typed as a loose string makes every edit site cast. The database column is
 * this enum, so nothing is being claimed that is not already true.
 */
export type Difficulty = (typeof DIFFICULTIES)[number];

export const AdminRecipeFilterSchema = PageRequestSchema.extend({
    /** Matched against the accent-FOLDED name, the way the catalogue is searched. */
    query: z.string().trim().max(200).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    origin: z.enum(["generated", "imported"]).optional(),
    /**
     * Three-valued on purpose, and `all` is not the default.
     *
     * The console's ordinary job is curating what readers can see, so it opens
     * on the visible set; `hidden` is the "what have I pulled" list the partial
     * index exists for. Defaulting to `all` would put withdrawn dishes back in
     * front of the curator with nothing marking them as different.
     */
    visibility: z.enum(["visible", "hidden", "all"]).default("visible"),
    /** Dishes with no illustration — the working list for a regeneration pass. */
    missingImage: FlagSchema,
    /**
     * Dishes whose image host is unreachable by a reader. The working list for
     * `repair-image-urls`, and deliberately not folded into `missingImage`:
     * these have art, in the right bucket, under the right key.
     */
    unreachableImage: FlagSchema,
    sort: z.enum(["createdAt", "name", "favouriteCount"]).default("createdAt"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminRecipeFilter = z.infer<typeof AdminRecipeFilterSchema>;

/** One row in the console's recipe table. Deliberately not the full recipe. */
export interface AdminRecipeRow {
    id: string;
    name: string;
    nameEn: string | null;
    shortDescription: string | null;
    image: string | null;
    difficulty: Difficulty | null;
    totalTimeMinutes: number | null;
    servings: number;
    favouriteCount: number;
    origin: string;
    isGenerated: boolean;
    isPersonal: boolean;
    /** Non-null means this is somebody's private import, not the catalogue. */
    createdBy: string | null;
    baseRecipeId: string | null;
    identityCuisine: string | null;
    hiddenAt: string | null;
    hiddenReason: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AdminRecipeIngredient {
    id: string;
    ingredientId: string;
    name: string;
    quantity: number | null;
    unitId: string | null;
    unitName: string | null;
    /** The column really is `comment` — "2 cloves, finely sliced". */
    comment: string | null;
}

export interface AdminRecipeStep {
    id: string;
    stepNumber: number;
    /** `recipe_instructions.instruction_text`, carried under its own name. */
    instructionText: string;
    title: string | null;
    durationSeconds: number | null;
    temperatureC: number | null;
    equipment: string[] | null;
    /**
     * Singular on a step and PLURAL on the recipe — `recipe_instructions.tips`
     * is one `text` column, `recipes.tips` is a `text[]`. Carried as the
     * database has it rather than harmonised: a step's tip is one aside, and
     * making it an array here would invent a shape the writer never produces.
     */
    tips: string | null;
}

export interface AdminRecipeTag {
    id: string;
    name: string;
    type: string;
}

/**
 * How many things a reader put somewhere that point at this dish.
 *
 * Shown before a hide, because hiding is "gone for everyone": a favourite, a
 * planned night or a shopping list referencing a hidden dish resolves to
 * nothing. The console states the number rather than preventing the press —
 * withdrawing a dish that people saved is sometimes exactly the intent, and an
 * admin tool that refuses is one that gets worked around.
 */
export interface AdminRecipeReferences {
    favourites: number;
    collections: number;
    shoppingLists: number;
    menuCourses: number;
    variants: number;
}

export interface AdminRecipeDetail extends AdminRecipeRow {
    description: string | null;
    prepTime: string | null;
    cookTime: string | null;
    tips: string[] | null;
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    canonicalId: string | null;
    sourceSuggestionId: string | null;
    thumbhash: string | null;
    ingredients: AdminRecipeIngredient[];
    steps: AdminRecipeStep[];
    tags: AdminRecipeTag[];
    references: AdminRecipeReferences;
}

/**
 * Editable fields, and the list is the decision.
 *
 * Everything here is prose or a number a person can judge. What is absent is
 * absent on purpose: `canonical_id`, `name_ascii`, `fts`, `thumbhash` and the
 * `*_ascii` twins are DERIVED — `name_ascii` is computed by a generated column
 * and the canonical id is what dedup joins on, so a hand-edited one silently
 * splits a dish's family. `image` is absent because the storage path is
 * derived from the name; the way to change a picture is to regenerate it.
 *
 * **`name` IS editable and it is the sharp one.** The illustration's storage
 * path is `normalizeFileName(name)`, so renaming a dish points it at an object
 * that does not exist yet. The handler says so; the console warns.
 */
export const AdminRecipeUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(200),
        nameEn: z.string().trim().max(200).nullable(),
        description: z.string().trim().max(5000).nullable(),
        shortDescription: z.string().trim().max(500).nullable(),
        difficulty: z.enum(DIFFICULTIES).nullable(),
        servings: z.number().int().min(1).max(100),
        prepTime: z.string().trim().max(50).nullable(),
        cookTime: z.string().trim().max(50).nullable(),
        totalTimeMinutes: z.number().int().min(0).max(100000).nullable(),
        kcal: z.number().min(0).max(100000).nullable(),
        protein: z.number().min(0).max(10000).nullable(),
        carbs: z.number().min(0).max(10000).nullable(),
        fat: z.number().min(0).max(10000).nullable(),
        tips: z.array(z.string().trim().max(1000)).max(20).nullable(),
        identityCuisine: z.string().trim().max(100).nullable(),
    })
    // Partial, so the console can PATCH one field without round-tripping a
    // whole recipe it may be holding a stale copy of.
    .partial();

export type AdminRecipeUpdate = z.infer<typeof AdminRecipeUpdateSchema>;

/**
 * Steps are replaced WHOLESALE, never patched row by row.
 *
 * `step_number` is a position, so a per-row edit makes the console responsible
 * for renumbering everything after an insert or a delete — and a half-applied
 * renumber is two steps claiming position 4, which sorts arbitrarily and reads
 * as a recipe that lost a step. Sending the list means the order is whatever
 * the array says.
 *
 * What is NOT here is `cooking_action_id` and `ingredient_refs`: both are
 * derived at write time by the generator, and cook mode's marked ingredients
 * are computed from the text. An editor that let them be set by hand would let
 * a step point at an ingredient the sentence does not mention.
 */
export const AdminRecipeStepsSchema = z.object({
    steps: z
        .array(
            z.object({
                instructionText: z.string().trim().min(1).max(4000),
                title: z.string().trim().max(200).nullable().default(null),
                durationSeconds: z
                    .number()
                    .int()
                    .min(0)
                    .max(86400)
                    .nullable()
                    .default(null),
                temperatureC: z
                    .number()
                    .int()
                    .min(0)
                    .max(500)
                    .nullable()
                    .default(null),
                equipment: z.array(z.string().trim().max(100)).max(20).nullable().default(null),
                tips: z.string().trim().max(1000).nullable().default(null),
            })
        )
        .max(60),
});

export type AdminRecipeStepsUpdate = z.infer<typeof AdminRecipeStepsSchema>;

/**
 * Regenerating the illustration.
 *
 * `force` is not optional in practice and is still declared: the renderer
 * short-circuits on an existing storage object, which is exactly right for the
 * generation path and exactly wrong here — without it the button costs a
 * storage `list` and returns the picture the curator is trying to replace.
 */
export const RegenerateImageSchema = z.object({
    force: z.boolean().default(true),
});

export interface RegenerateImageResponse {
    /**
     * The hero URL. Unchanged by construction — the path is derived from the
     * dish's name — so the console cache-busts its own `<img>` and nothing is
     * written to `recipes.image`.
     */
    url: string;
    thumbhash: string | null;
    /** Rows repointed at the new picture: a dish and its variants share one. */
    recipesUpdated: number;
}
