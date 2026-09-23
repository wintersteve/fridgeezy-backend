import {
    AdminIngredientFilterSchema,
    AdminIngredientUpdateSchema,
    type AdminCategory,
    type AdminIngredientRow,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { likeTerm, parseBody, parseQuery, toPage } from "../../services";

/**
 * Named columns again, and here it matters twice over: `ingredients` carries
 * both `embedding` and `nutritional_info`, and the table is the largest in the
 * schema at roughly a thousand rows.
 */
const LIST_COLUMNS = `
    id, name, canonical_id, category_id, use_count, default_shelf_life_days,
    expires_by_default, component_kind, component_dish,
    categories(name), ingredient_aliases(alias)
`;

/**
 * `GET /rest/admin/ingredients` — the catalogue everything else is keyed on.
 *
 * ## `use_count` is the default sort, and that is the useful one
 *
 * It exists so the pickers can rank by what recipes actually call for, and it
 * is the same ranking a curator wants: the ingredient in seventy dishes is the
 * one whose category or shelf life is worth an argument, and the one in none is
 * usually a duplicate waiting to be merged.
 *
 * ## The two "unfinished" filters are the real working lists
 *
 * `missingShelfLife` is the backfill's remainder — the operation that fills
 * `default_shelf_life_days` reads a free-text `shelf_life` sentence, and until
 * a row has a number it decays on the flat thirty-day fallback, which treats
 * spinach like cumin. `componentKind` finds what the component classifier has
 * not reached, where an unclassified row draws exactly what `bought` draws:
 * nothing.
 */
export async function listIngredients(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminIngredientFilterSchema, req, res);

    if (!filter) return;

    let query = supabaseAdmin
        .from("ingredients")
        .select(LIST_COLUMNS, { count: "exact" });

    if (filter.query) query = query.ilike("name_ascii", likeTerm(filter.query));
    if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
    if (filter.componentKind) query = query.eq("component_kind", filter.componentKind);
    if (filter.missingShelfLife) query = query.is("default_shelf_life_days", null);

    // The key names a FIELD and the direction is its own parameter, so every
    // column a header sits over can be asked for either way round. The
    // tiebreaker below is not decoration: `range()` is an OFFSET, so two rows
    // sharing a value can swap between page one and page two and the console
    // shows one of them twice and the other never.
    const column = {
        useCount: "use_count",
        name: "name",
        createdAt: "created_at",
    }[filter.sort];

    const { data, error, count } = await query
        .order(column, { ascending: filter.dir === "asc" })
        .order("id", { ascending: true })
        .range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listIngredients failed", error);
        res.status(500).json({ error: "Could not list ingredients" });
        return;
    }

    const rows: AdminIngredientRow[] = (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        canonicalId: row.canonical_id,
        categoryId: row.category_id,
        categoryName: row.categories?.name ?? null,
        useCount: row.use_count,
        defaultShelfLifeDays: row.default_shelf_life_days,
        expiresByDefault: row.expires_by_default,
        componentKind: row.component_kind,
        componentDish: row.component_dish,
        aliases: (row.ingredient_aliases ?? []).map((alias) => alias.alias),
    }));

    res.json(toPage(rows, count, filter));
}

/**
 * `PATCH /rest/admin/ingredients/:id`.
 *
 * ## `component_dish_canonical_id` is generated and therefore absent
 *
 * Setting `component_dish` is enough: the database derives the canonical form
 * from it, which is the column the "make it yourself" lookup joins on. Writing
 * it by hand here is not possible and would be the bug if it were —
 * `toCanonicalId` in the client mirrors the SQL exactly, and a third
 * hand-written spelling is how a marked ingredient silently pays for a
 * generation of a dish the catalogue already has.
 *
 * ## `component_kind` is the field with an asymmetric cost
 *
 * A missed `dish` costs a link nobody notices. A wrong one offers to make SOY
 * SAUCE, which is visibly absurd and teaches the reader to ignore the marker
 * everywhere it is right. The classifier's prompt leans toward `bought` for
 * that reason; a hand edit should lean the same way.
 */
export async function updateIngredient(req: Request, res: Response): Promise<void> {
    const update = parseBody(AdminIngredientUpdateSchema, req, res);

    if (!update) return;

    if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
    }

    const patch: Record<string, unknown> = {};

    if ("name" in update) patch.name = update.name;
    if ("categoryId" in update) patch.category_id = update.categoryId;
    if ("defaultShelfLifeDays" in update) {
        patch.default_shelf_life_days = update.defaultShelfLifeDays;
    }
    if ("expiresByDefault" in update) patch.expires_by_default = update.expiresByDefault;
    if ("componentKind" in update) patch.component_kind = update.componentKind;
    if ("componentDish" in update) patch.component_dish = update.componentDish;

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .update(patch)
        .eq("id", req.params.id)
        .select("id")
        .maybeSingle();

    if (error) {
        console.error("[admin] updateIngredient failed", error);
        res.status(500).json({ error: "Could not update ingredient" });
        return;
    }

    if (!data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    console.log(
        `[admin] ${req.adminProfileId} updated ingredient ${req.params.id}: ${Object.keys(update).join(", ")}`
    );

    res.json({ updated: true });
}

/**
 * `GET /rest/admin/categories` — the twenty fixed ingredient categories, with
 * how many ingredients each holds.
 *
 * The count is what makes this more than a dropdown feed: a category holding
 * two rows is usually a classification mistake rather than a real shelf.
 */
export async function listCategories(_req: Request, res: Response): Promise<void> {
    const [categories, ingredients] = await Promise.all([
        supabaseAdmin.from("categories").select("id, name").order("name"),
        supabaseAdmin.from("ingredients").select("category_id"),
    ]);

    if (categories.error) {
        console.error("[admin] listCategories failed", categories.error);
        res.status(500).json({ error: "Could not list categories" });
        return;
    }

    // Counted here rather than with twenty `head` requests: the whole column is
    // one round trip of a thousand uuids, against twenty round trips.
    const counts = new Map<string, number>();

    for (const row of ingredients.data ?? []) {
        if (!row.category_id) continue;
        counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }

    const rows: AdminCategory[] = (categories.data ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        ingredientCount: counts.get(category.id) ?? 0,
    }));

    res.json(rows);
}
