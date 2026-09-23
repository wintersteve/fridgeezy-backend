import { z } from "zod/v4";

import { PageRequestSchema, SortDirectionSchema } from "./common";

export const TAG_TYPES = [
    "cuisine",
    "course",
    "dish_form",
    "dietary",
    "component",
] as const;

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
    type: string;
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
