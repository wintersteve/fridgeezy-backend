import { z } from "zod/v4";

/**
 * The shapes `/rest/admin/*` speaks, shared by the handler that validates them
 * and the console that sends them.
 *
 * It is a library of its own rather than a corner of `@fridgeezy/schemas`
 * because that package is **packed into the React Native client** — every
 * schema in it is installed on a phone. Nothing here is of any use to the app,
 * and the admin console is the only other caller, so a second `scope:shared`
 * lib costs one workspace entry and keeps the client's tarball the size of the
 * contract it actually speaks.
 */

/** A page of rows, plus what it takes to ask for the next one. */
export const PageRequestSchema = z.object({
    /**
     * Rows per page. Capped rather than clamped-on-read: every list here is a
     * service-role read with no RLS to bound it, so the ceiling belongs in the
     * validator where a caller can be told they exceeded it.
     */
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export type PageRequest = z.infer<typeof PageRequestSchema>;

/**
 * A checkbox arriving in a query string.
 *
 * **NOT `z.coerce.boolean()`**, which is the obvious choice and is wrong in a
 * way that is hard to see: coercion is `Boolean(value)`, and `Boolean("false")`
 * is `true`. Every explicit "off" therefore reads as ON — `?missingImage=false`
 * applied the filter, which is the exact opposite of what it says.
 *
 * It survived review because the console only ever sends the parameter when the
 * box is ticked and deletes it otherwise, so the broken value was never
 * produced by the one caller there is. That is luck, not a design: anything
 * else building these URLs — a bookmark, a link in the Overview, a script —
 * would hit it immediately.
 */
export const FlagSchema = z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1");

/**
 * Which way a sorted column runs.
 *
 * Split out from the sort key, which is the change that made the table headers
 * honest. The enums here used to name a key and a direction together —
 * `newest`, `oldest`, `name`, `favourites` — which reads well in a dropdown and
 * cannot express half of what a header needs: there was no way to ask for Z–A
 * or for the least-saved dish, so a header could sort one way and then had
 * nothing to do on a second press. Naming the COLUMN and the DIRECTION
 * separately gives every column both, and takes the odd couple `newest`/
 * `oldest` out of a vocabulary where everything else was a field.
 *
 * The keys are the console's own row FIELDS (`createdAt`, `favouriteCount`),
 * not database columns: the header sits over a field, and a tag's usage count
 * is not a column at all.
 */
export const SortDirectionSchema = z.enum(["asc", "desc"]);

export type SortDirection = z.infer<typeof SortDirectionSchema>;

export interface Page<T> {
    rows: T[];
    /**
     * Rows matching the filters, not rows returned. The console draws
     * "showing 50 of 412" from it, so it is counted server-side rather than
     * inferred from a short page — the same argument `find_recipes` records for
     * returning `total_recipes` alongside its slice.
     */
    total: number;
    limit: number;
    offset: number;
}

/**
 * Hiding and unhiding are one route and one schema.
 *
 * A pair of verbs would mean two paths that must stay in step about what a
 * hide COSTS, and the console's control is a toggle either way. `reason` is
 * admin-facing only — no reader surface has anywhere to put it.
 */
export const SetHiddenSchema = z.object({
    hidden: z.boolean(),
    reason: z.string().trim().max(500).optional(),
});

export type SetHiddenRequest = z.infer<typeof SetHiddenSchema>;

/**
 * Which Google account a render will be billed to.
 *
 * Reported on every screen that can spend money on images, because the two
 * backends draw the same picture out of two different budgets and nothing else
 * on the page would say which: **AI Studio bills a prepay balance; Vertex bills
 * an ordinary Cloud project and so can be paid for with Cloud credit.** That is
 * the entire reason the split exists, and pressing a nine-dollar button without
 * knowing which side of it you are on is exactly the thing worth preventing.
 *
 * It describes IMAGE generation only. Speech and every text call stay on the
 * API key whatever this says — the TTS models this repo pins are not served by
 * Vertex, so moving them would break cook mode's read-aloud.
 */
export interface ImageBillingPath {
    /** True when a Vertex project is configured and images will go there. */
    vertex: boolean;
    /** The Cloud project images are billed to, or null on the API-key path. */
    project: string | null;
    location: string | null;
}

/**
 * A dish, named and linkable, as a detail page refers to one.
 *
 * Deliberately not `AdminRecipeRow`: these lists are CONTEXT — which recipes
 * use this ingredient, which carry this tag — and a page that embedded the full
 * card row for each would fetch every column and every child of forty recipes
 * to print forty names. A name and an id is what a link needs.
 */
export interface AdminDishRef {
    id: string;
    name: string;
    hiddenAt: string | null;
}
