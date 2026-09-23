import {
    AdminTagFilterSchema,
    AdminTagUpdateSchema,
    type AdminTagRow,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { likeTerm, parseBody, parseQuery, toPage } from "../../services";

/** `embedding` excluded by naming the rest — tags carry one for the entity strip. */
const LIST_COLUMNS = `
    id, name, type, parent_id, canonical_id, tag_aliases(alias)
`;

/**
 * `GET /rest/admin/tags` — the taxonomy, with how many recipes carry each.
 *
 * ## The count is the whole reason this screen exists
 *
 * A tag is only worth a row if dishes carry it, and the distribution here is
 * lopsided by design: ~170 cuisines against 4 courses. A cuisine on one recipe
 * is usually a spelling the generator invented rather than a real cuisine, and
 * that is invisible without the number.
 *
 * ## Counted in one pass, not one query per tag
 *
 * `recipe_tags` is small enough to read whole — one row per (recipe, tag) — and
 * counting it in memory costs one round trip against several hundred `head`
 * requests. If that ever stops being true the answer is a view with a count,
 * not a loop.
 *
 * ## `sort: "usage"` therefore sorts the PAGE, not the table
 *
 * The count is not a column, so the database cannot order by it. Sorting by
 * usage reads the whole table and slices afterwards — affordable at a few
 * hundred rows, and stated here rather than left for somebody to discover when
 * a page boundary looks wrong.
 */
export async function listTags(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminTagFilterSchema, req, res);

    if (!filter) return;

    const usageSort = filter.sort === "recipeCount";
    const ascending = filter.dir === "asc";

    let query = supabaseAdmin
        .from("tags")
        .select(LIST_COLUMNS, { count: "exact" });

    if (filter.query) query = query.ilike("name_ascii", likeTerm(filter.query));
    if (filter.type) query = query.eq("type", filter.type);

    // Ordered by name even when the caller asked for usage, because the usage
    // pass below needs a deterministic order to break its own ties on.
    query = query
        .order("name", { ascending: usageSort ? true : ascending })
        .order("id", { ascending: true });

    // Usage ordering has to see every row before it can rank one, so the page
    // is taken after the sort rather than by the database.
    const { data, error, count } = usageSort
        ? await query
        : await query.range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listTags failed", error);
        res.status(500).json({ error: "Could not list tags" });
        return;
    }

    const [links, parents] = await Promise.all([
        supabaseAdmin.from("recipe_tags").select("tag_id"),
        supabaseAdmin.from("tags").select("id, name"),
    ]);

    const counts = new Map<string, number>();

    for (const link of links.data ?? []) {
        counts.set(link.tag_id, (counts.get(link.tag_id) ?? 0) + 1);
    }

    const nameById = new Map((parents.data ?? []).map((tag) => [tag.id, tag.name]));

    let rows: AdminTagRow[] = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        parentId: row.parent_id,
        parentName: row.parent_id ? (nameById.get(row.parent_id) ?? null) : null,
        recipeCount: counts.get(row.id) ?? 0,
        aliases: (row.tag_aliases ?? []).map((alias) => alias.alias),
    }));

    if (usageSort) {
        rows = rows
            .sort(
                (a, b) =>
                    (ascending
                        ? a.recipeCount - b.recipeCount
                        : b.recipeCount - a.recipeCount) || a.name.localeCompare(b.name)
            )
            .slice(filter.offset, filter.offset + filter.limit);
    }

    res.json(toPage(rows, count, filter));
}

/**
 * `PATCH /rest/admin/tags/:id`.
 *
 * `canonical_id` is absent for the reason it is everywhere else here: it is
 * what the entity strip, the quick-filter chips and `find_recipes`' tag subtree
 * all join on. Renaming a tag's DISPLAY name is a correction; changing what it
 * joins on is a merge.
 *
 * **`type` is editable and it is the field to be careful with.** It decides
 * which dimension a tag filters in, and `find_recipes` walks a tag SUBTREE — so
 * moving a tag between types while it has a parent leaves a cuisine hanging
 * under a course. The parent is not cleared automatically; the console shows
 * both and lets the curator say what they mean.
 */
export async function updateTag(req: Request, res: Response): Promise<void> {
    const update = parseBody(AdminTagUpdateSchema, req, res);

    if (!update) return;

    if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
    }

    if (update.parentId && update.parentId === req.params.id) {
        // Cheap, and the failure it prevents is not: `find_recipes` resolves a
        // tag's subtree recursively, so a tag parented to itself is a query
        // that does not return.
        res.status(400).json({ error: "A tag cannot be its own parent" });
        return;
    }

    const patch: Record<string, unknown> = {};

    if ("name" in update) patch.name = update.name;
    if ("type" in update) patch.type = update.type;
    if ("parentId" in update) patch.parent_id = update.parentId;

    const { data, error } = await supabaseAdmin
        .from("tags")
        .update(patch)
        .eq("id", req.params.id)
        .select("id")
        .maybeSingle();

    if (error) {
        console.error("[admin] updateTag failed", error);
        res.status(500).json({ error: "Could not update tag" });
        return;
    }

    if (!data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    console.log(
        `[admin] ${req.adminProfileId} updated tag ${req.params.id}: ${Object.keys(update).join(", ")}`
    );

    res.json({ updated: true });
}
