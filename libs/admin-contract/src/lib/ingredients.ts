import { z } from "zod/v4";

import type { AdminDishRef } from "./common";
import { FlagSchema, PageRequestSchema, SortDirectionSchema } from "./common";

export const COMPONENT_KINDS = ["dish", "prep", "bought"] as const;

/**
 * Narrowed rather than `string`, and it earns that the same way `Difficulty`
 * does: the database column IS this enum, and a row typed as a loose string
 * makes every edit site cast on the way back into `AdminIngredientUpdate`.
 */
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const AdminIngredientFilterSchema = PageRequestSchema.extend({
    query: z.string().trim().max(200).optional(),
    categoryId: z.uuid().optional(),
    componentKind: z.enum(COMPONENT_KINDS).optional(),
    /**
     * Rows the shelf-life backfill has not reached. 45 of ~1041 carried a
     * number when that operation was written and 360 carried the sentence it
     * comes from, so "what is still undecided" is the working list here.
     */
    missingShelfLife: FlagSchema,
    sort: z.enum(["useCount", "name", "createdAt"]).default("useCount"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminIngredientFilter = z.infer<typeof AdminIngredientFilterSchema>;

export interface AdminIngredientRow {
    id: string;
    name: string;
    canonicalId: string | null;
    categoryId: string | null;
    categoryName: string | null;
    useCount: number;
    defaultShelfLifeDays: number | null;
    expiresByDefault: boolean | null;
    componentKind: ComponentKind | null;
    componentDish: string | null;
    aliases: string[];
}

/**
 * What may be edited on an ingredient, and what may not.
 *
 * `canonical_id` is absent for the reason the recipe's is: it is the join key
 * dedup and the component lookup both run on, and it mirrors a SQL function
 * (`normalize_to_canonical_id`) exactly. Editing it by hand is how one
 * ingredient becomes two that never merge again.
 */
export const AdminIngredientUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(200),
        categoryId: z.uuid().nullable(),
        defaultShelfLifeDays: z.number().int().min(0).max(36500).nullable(),
        expiresByDefault: z.boolean(),
        componentKind: z.enum(COMPONENT_KINDS).nullable(),
        componentDish: z.string().trim().max(200).nullable(),
    })
    .partial();

export type AdminIngredientUpdate = z.infer<typeof AdminIngredientUpdateSchema>;

/**
 * One ingredient, with the things a ROW cannot hold.
 *
 * The editable fields are the row's, unchanged — what earns this a page of its
 * own is the rest: every alias in full rather than the first three, and the
 * dishes that actually use it. That last list is the answer to the question a
 * curator is really asking when they open an ingredient ("is this the row
 * everything joins on, or the duplicate?"), and it is the one thing a table
 * cell has no room for.
 */
export interface AdminIngredientDetail extends AdminIngredientRow {
    description: string | null;
    shelfLife: string | null;
    storageTips: string | null;
    /** Vector present, so the resolver can reach this row by similarity. */
    hasEmbedding: boolean;
    dietaryProperties: string[] | null;
    /** Recipes holding it, newest first, capped — see the usecase. */
    usedIn: AdminDishRef[];
    usedInTotal: number;
}

export interface AdminCategory {
    id: string;
    name: string;
    ingredientCount: number;
}
