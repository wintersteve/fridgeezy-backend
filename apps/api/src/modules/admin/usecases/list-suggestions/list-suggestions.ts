import {
    AdminSuggestionFilterSchema,
    type AdminSuggestionRow,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { likeTerm, parseQuery, toPage } from "../../services";

/**
 * Columns, named — `embedding` is on this table and is a 1536-float vector
 * serialised as text. A page of fifty would be several megabytes for a list
 * showing a name and a gloss.
 */
const LIST_COLUMNS = `
    id, name, name_en, description, canonical_id, difficulty,
    total_time_minutes, identity_cuisine, hidden_at, hidden_reason, created_at
`;

/**
 * `GET /rest/admin/suggestions` — the pool of dish ideas.
 *
 * Roughly an order of magnitude larger than the recipe catalogue, and almost
 * none of it has been promoted. That imbalance is the reason `MAX_FEED_IDEAS`
 * exists on the client, and it is why this list's most useful filter is
 * `promoted`.
 *
 * ## Promotion is resolved in a second query, not a join
 *
 * `recipes.source_suggestion_id` carries no foreign key, so PostgREST has no
 * relationship to embed through — an `!inner` join is not available at all
 * here. One `in(...)` over the page's own ids answers it instead: at most fifty
 * values, which is comfortably inside the query-string length the server will
 * accept (the same **414** ceiling the client hits at a few hundred).
 *
 * The `promoted` FILTER is the harder half, because filtering on a column of
 * another table is exactly what PostgREST cannot do without a relationship. It
 * is applied after the page is read, which means a filtered page can come back
 * shorter than `limit` and the total is the unfiltered one. Said plainly
 * rather than hidden: this is a curation list, the console shows what it got,
 * and the honest fix is a view — which is a migration this did not need.
 */
export async function listSuggestions(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminSuggestionFilterSchema, req, res);

    if (!filter) return;

    let query = supabaseAdmin
        .from("recipe_suggestions")
        .select(LIST_COLUMNS, { count: "exact" });

    if (filter.query) {
        query = query.ilike("name_ascii", likeTerm(filter.query));
    }

    if (filter.visibility === "visible") query = query.is("hidden_at", null);
    if (filter.visibility === "hidden") query = query.not("hidden_at", "is", null);

    // The key names a FIELD and the direction is its own parameter, so every
    // column a header sits over can be asked for either way round. The
    // tiebreaker below is not decoration: `range()` is an OFFSET, so two rows
    // sharing a value can swap between page one and page two and the console
    // shows one of them twice and the other never.
    const column = { createdAt: "created_at", name: "name" }[filter.sort];

    const { data, error, count } = await query
        .order(column, { ascending: filter.dir === "asc" })
        .order("id", { ascending: true })
        .range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listSuggestions failed", error);
        res.status(500).json({ error: "Could not list suggestions" });
        return;
    }

    const suggestions = data ?? [];

    const { data: promotedRows } = suggestions.length
        ? await supabaseAdmin
              .from("recipes")
              .select("id, source_suggestion_id")
              .in(
                  "source_suggestion_id",
                  suggestions.map((row) => row.id)
              )
        : { data: [] };

    const promotedBySuggestion = new Map(
        (promotedRows ?? [])
            .filter((row) => row.source_suggestion_id)
            .map((row) => [row.source_suggestion_id as string, row.id])
    );

    let rows: AdminSuggestionRow[] = suggestions.map((row) => ({
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        description: row.description,
        canonicalId: row.canonical_id,
        difficulty: row.difficulty,
        totalTimeMinutes: row.total_time_minutes,
        identityCuisine: row.identity_cuisine,
        hiddenAt: row.hidden_at,
        hiddenReason: row.hidden_reason,
        createdAt: row.created_at,
        promotedRecipeId: promotedBySuggestion.get(row.id) ?? null,
    }));

    if (filter.promoted === "promoted") {
        rows = rows.filter((row) => row.promotedRecipeId !== null);
    }

    if (filter.promoted === "unpromoted") {
        rows = rows.filter((row) => row.promotedRecipeId === null);
    }

    res.json(toPage(rows, count, filter));
}
