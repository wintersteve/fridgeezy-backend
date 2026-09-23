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

/**
 * One dish idea, with what it is made of.
 *
 * A suggestion has no METHOD — that is the whole definition of one — so the
 * page's job is to show what the generator actually wrote: the gloss, the
 * ingredient list and the tags it was filed under. That ingredient list is
 * also the only place a bad suggestion is visibly bad; the name and the gloss
 * usually read fine, and it is "Tiramisu · chicken thighs" that says the
 * generator lost the plot.
 */
export interface AdminSuggestionDetail extends AdminSuggestionRow {
    /**
     * No `servings`, deliberately: `recipe_suggestions` has no such column. A
     * suggestion is a name, a gloss and an ingredient list — the yield is
     * decided when it is promoted and a method is written.
     */
    /**
     * Names only — `recipe_suggestion_ingredients` carries no quantity and no
     * unit, which is the same fact as having no method: the amounts are
     * decided when the dish is promoted and written.
     */
    ingredients: { id: string; name: string }[];
    tags: { id: string; name: string; type: string }[];
    /** Set when the dish already exists as a recipe, so the page can link out. */
    promotedRecipeName: string | null;
}
