import { z } from "zod/v4";

import { PageRequestSchema, SortDirectionSchema } from "./common";

export const AdminSuggestionFilterSchema = PageRequestSchema.extend({
    query: z.string().trim().max(200).optional(),
    visibility: z.enum(["visible", "hidden", "all"]).default("visible"),
    /**
     * A suggestion whose dish already has a recipe. `find_recipes` suppresses
     * those from the feed anyway, so they are dead weight the console can
     * clear — which is the one bulk operation this table genuinely wants.
     */
    promoted: z.enum(["any", "promoted", "unpromoted"]).default("any"),
    sort: z.enum(["createdAt", "name"]).default("createdAt"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminSuggestionFilter = z.infer<typeof AdminSuggestionFilterSchema>;

export interface AdminSuggestionRow {
    id: string;
    name: string;
    nameEn: string | null;
    description: string | null;
    canonicalId: string;
    difficulty: string | null;
    totalTimeMinutes: number | null;
    identityCuisine: string | null;
    hiddenAt: string | null;
    hiddenReason: string | null;
    createdAt: string;
    /** The recipe this dish was promoted into, if any. */
    promotedRecipeId: string | null;
}
