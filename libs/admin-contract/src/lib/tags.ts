import { z } from "zod/v4";

import type { AdminDishRef } from "./common";
import { PageRequestSchema, SortDirectionSchema } from "./common";

export const TAG_TYPES = [
    "cuisine",
    "course",
    "dish_form",
    "dietary",
    "component",
] as const;

/**
 * Narrowed for the reason `ComponentKind` is: the column is this enum, and a
 * row typed as a loose string makes every edit site cast on the way back into
 * `AdminTagUpdate`.
 */
export type TagType = (typeof TAG_TYPES)[number];

export const AdminTagFilterSchema = PageRequestSchema.extend({
    query: z.string().trim().max(200).optional(),
    type: z.enum(TAG_TYPES).optional(),
    sort: z.enum(["recipeCount", "name"]).default("recipeCount"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminTagFilter = z.infer<typeof AdminTagFilterSchema>;

export interface AdminTagRow {
    id: string;
    name: string;
    type: TagType;
    parentId: string | null;
    parentName: string | null;
    /** Recipes carrying it — the only honest measure of whether it earns a row. */
    recipeCount: number;
    aliases: string[];
}

export const AdminTagUpdateSchema = z
    .object({
        name: z.string().trim().min(1).max(100),
        type: z.enum(TAG_TYPES),
        parentId: z.uuid().nullable(),
    })
    .partial();

export type AdminTagUpdate = z.infer<typeof AdminTagUpdateSchema>;

/**
 * One tag, with what the row could not say.
 *
 * `recipes` is the whole argument for the page. A tag's count is the only
 * honest measure of whether it earns a row at all, and the names behind that
 * count are what tell a real cuisine from a spelling to merge — "japanese 18"
 * and "japenese 1" look identical as figures and nothing alike as lists.
 *
 * `children` matters for the same reason from the other direction: `find_recipes`
 * walks a tag SUBTREE, so moving a tag with children between types takes them
 * with it, and the page has to show what would move.
 */
export interface AdminTagDetail extends AdminTagRow {
    recipes: AdminDishRef[];
    children: { id: string; name: string; recipeCount: number }[];
}
