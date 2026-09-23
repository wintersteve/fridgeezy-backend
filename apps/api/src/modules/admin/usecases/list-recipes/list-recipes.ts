import {
    AdminRecipeFilterSchema,
    type AdminRecipeRow,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { isPubliclyServed } from "@fridgeezy/toolkit";
import type { Request, Response } from "express";

import {
    fetchRecipeArtIndex,
    isArtMissing,
    likeTerm,
    parseQuery,
    toPage,
} from "../../services";

/**
 * The columns the table draws. Named rather than `select("*")` — the recipes
 * row carries `fts`, which is a 1536-dimension vector serialised as text, and
 * a page of fifty of those is megabytes of JSON for a list that shows a name
 * and a picture. That exact mistake is on record as a production slowness fix.
 */
const LIST_COLUMNS = `
    id, name, name_en, short_description, image, difficulty, total_time_minutes,
    servings, favourite_count, origin, is_generated, is_personal, created_by,
    base_recipe_id, identity_cuisine, hidden_at, hidden_reason, created_at, updated_at
`;

/**
 * `GET /rest/admin/recipes` — the catalogue, filtered.
 *
 * Service role, so no policy applies and **this is the one read in the system
 * that can see a hidden dish**. That is the point of the console; it is also
 * why `requireAdmin` is the only thing standing in front of it.
 *
 * ## The search is accent-blind, like the app's
 *
 * `name_ascii` is a stored folded twin maintained by the database, so
 * "bechamel" finds "Béchamel Sauce" here exactly as it does in the app. Folding
 * an already-plain term changes nothing, which is what makes matching the
 * folded column a strict superset rather than a different search.
 */
export async function listRecipes(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminRecipeFilterSchema, req, res);

    if (!filter) return;

    let query = supabaseAdmin
        .from("recipes")
        // `count: "exact"` rides on this same request, so the console's
        // "showing 50 of 412" costs nothing extra.
        .select(LIST_COLUMNS, { count: "exact" });

    if (filter.query) {
        query = query.ilike("name_ascii", likeTerm(filter.query));
    }

    if (filter.difficulty) query = query.eq("difficulty", filter.difficulty);
    if (filter.origin) query = query.eq("origin", filter.origin);

    if (filter.visibility === "visible") query = query.is("hidden_at", null);
    if (filter.visibility === "hidden") query = query.not("hidden_at", "is", null);

    // Dishes whose picture is genuinely absent from the bucket.
    //
    // NOT `is("image", null)`, which is what this was and which can never
    // match: persistence stores a PREDICTED url derived from the dish's name
    // without waiting for the upload, so the column is non-null even when no
    // object was ever written. Production proved it — `missingImage: 0` on a
    // catalogue containing a dish with no art.
    //
    // Storage cannot be joined against, so the ids are resolved first and
    // handed back as an `in` filter, which keeps the paging, the count and the
    // sort below on the server where the rest of this function already is.
    // Bounded by the `in` filter's own ceiling: PostgREST puts it in the query
    // string, which the server refuses past roughly 250 ids with a 414. The
    // same trade `listTags` records for its usage sort, and at a catalogue of
    // 54 it is a long way off.
    if (filter.missingImage) {
        const [artIndex, allRows] = await Promise.all([
            fetchRecipeArtIndex(),
            supabaseAdmin.from("recipes").select("id, image"),
        ]);

        const missing = (allRows.data ?? [])
            .filter((row) => isArtMissing(row.image, artIndex))
            .map((row) => row.id);

        // An empty `in` list is not a no-op in PostgREST, and an unusable index
        // must report nothing rather than everything — so both collapse to a
        // filter that matches no row.
        query = missing.length
            ? query.in("id", missing)
            : query.is("id", null);
    }

    // The rows `repair-image-urls` would rewrite: art exists, in the right
    // bucket, under the right key — only the host is one no reader can reach.
    // Deliberately a different filter from `missingImage`: those need a
    // generation, these need a string replaced.
    //
    // Yields nothing on a local stack, where a private storage host is correct.
    // Expressed as an unsatisfiable filter rather than an early return so the
    // paging, the count and the sort below stay on one code path.
    if (filter.unreachableImage) {
        const url = process.env.SUPABASE_URL;

        query = url && isPubliclyServed(url)
            ? query.not("image", "is", null).not("image", "like", `${new URL(url).origin}%`)
            : query.is("id", null);
    }

    // The key names a FIELD and the direction is its own parameter, so every
    // column a header sits over can be asked for either way round. The
    // tiebreaker below is not decoration: `range()` is an OFFSET, so two rows
    // sharing a value can swap between page one and page two and the console
    // shows one of them twice and the other never.
    const column = {
        createdAt: "created_at",
        name: "name",
        favouriteCount: "favourite_count",
    }[filter.sort];

    const { data, error, count } = await query
        .order(column, { ascending: filter.dir === "asc" })
        .order("id", { ascending: true })
        .range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listRecipes failed", error);
        res.status(500).json({ error: "Could not list recipes" });
        return;
    }

    const rows: AdminRecipeRow[] = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        shortDescription: row.short_description,
        image: row.image,
        difficulty: row.difficulty,
        totalTimeMinutes: row.total_time_minutes,
        servings: row.servings,
        favouriteCount: row.favourite_count,
        origin: row.origin,
        isGenerated: row.is_generated,
        isPersonal: row.is_personal,
        createdBy: row.created_by,
        baseRecipeId: row.base_recipe_id,
        identityCuisine: row.identity_cuisine,
        hiddenAt: row.hidden_at,
        hiddenReason: row.hidden_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));

    res.json(toPage(rows, count, filter));
}
