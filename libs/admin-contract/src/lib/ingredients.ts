import { z } from "zod/v4";

import { FlagSchema, PageRequestSchema, SortDirectionSchema } from "./common";

export const COMPONENT_KINDS = ["dish", "prep", "bought"] as const;

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
    componentKind: string | null;
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

export interface AdminCategory {
    id: string;
    name: string;
    ingredientCount: number;
}
