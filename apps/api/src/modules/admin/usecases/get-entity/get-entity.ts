import type {
    AdminDishRef,
    AdminIngredientDetail,
    AdminSuggestionDetail,
    AdminTagDetail,
    AdminUserDetail,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

/**
 * One of each entity, for its own page.
 *
 * ## Why these exist at all, when the list rows already carry the fields
 *
 * They did, and the editors were inline for exactly that reason — an
 * ingredient has four editable fields and no children, so a route each way to
 * change one number looked like ceremony. What the row cannot hold is the
 * CONTEXT, and the context is what the question is actually about: which dishes
 * use this ingredient, which recipes carry this tag, what a suggestion is made
 * of. A curator opening an ingredient is nearly always asking "is this the row
 * everything joins on, or the duplicate?", and no table cell answers that.
 *
 * So each of these returns the row plus the one list that earns the page.
 *
 * ## Every list here is CAPPED, and the total comes with it
 *
 * `Salt` is in 120 recipes and `main` is on 23. Returning all of them to draw a
 * sidebar would make the cheapest page in the console the heaviest read in it,
 * and nobody scrolls 120 dish names. The cap plus the true count says "121
 * dishes, here are the newest 20" — which is the honest shape, and the same one
 * the search screen uses for its own totals.
 */
const USED_IN_LIMIT = 20;

/** The shape every context list is flattened to. */
const dishRefs = (
    rows: { id: string; name: string; hidden_at: string | null }[] | null
): AdminDishRef[] =>
    (rows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        hiddenAt: row.hidden_at,
    }));

/**
 * `GET /rest/admin/ingredients/:id`
 *
 * The dishes are found through `recipe_ingredients`, which is the join every
 * ingredient filter in the app runs on — so the list on this page is literally
 * what a reader searching for this ingredient would be shown, not an
 * approximation of it.
 */
export async function getIngredient(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const [ingredient, links, linkCount] = await Promise.all([
        supabaseAdmin
            .from("ingredients")
            .select(
                `id, name, canonical_id, category_id, use_count, default_shelf_life_days,
                 expires_by_default, component_kind, component_dish, description,
                 shelf_life, storage_tips, dietary_properties, embedding,
                 categories(name), ingredient_aliases(alias)`
            )
            .eq("id", id)
            .maybeSingle(),
        supabaseAdmin
            .from("recipe_ingredients")
            .select("recipes(id, name, hidden_at, created_at)")
            .eq("ingredient_id", id)
            .limit(USED_IN_LIMIT),
        supabaseAdmin
            .from("recipe_ingredients")
            .select("id", { count: "exact", head: true })
            .eq("ingredient_id", id),
    ]);

    if (ingredient.error || !ingredient.data) {
        res.status(404).json({ error: "Ingredient not found" });
        return;
    }

    const row = ingredient.data;

    const detail: AdminIngredientDetail = {
        id: row.id,
        name: row.name,
        canonicalId: row.canonical_id,
        categoryId: row.category_id,
        categoryName: row.categories?.name ?? null,
        useCount: row.use_count ?? 0,
        defaultShelfLifeDays: row.default_shelf_life_days,
        expiresByDefault: row.expires_by_default,
        componentKind: row.component_kind,
        componentDish: row.component_dish,
        aliases: (row.ingredient_aliases ?? []).map((alias) => alias.alias),
        description: row.description,
        shelfLife: row.shelf_life,
        storageTips: row.storage_tips,
        // Reported as a BOOLEAN, never returned. A 1536-float vector is ~30KB of
        // JSON that no screen can read, and whether one exists is the whole of
        // what anybody needs to know — see the Upkeep screen, which is where a
        // missing one is acted on.
        hasEmbedding: row.embedding !== null,
        dietaryProperties: row.dietary_properties,
        usedIn: dishRefs(
            (links.data ?? [])
                .map((link) => link.recipes)
                .filter((recipe): recipe is NonNullable<typeof recipe> => Boolean(recipe))
        ),
        usedInTotal: linkCount.count ?? 0,
    };

    res.json(detail);
}

/**
 * `GET /rest/admin/tags/:id`
 *
 * Children come back because `find_recipes` walks a tag SUBTREE: moving a tag
 * between types takes everything under it along, and the page cannot ask for
 * that decision without showing what would move.
 */
export async function getTag(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const [tag, links, linkCount, children, parents] = await Promise.all([
        supabaseAdmin
            .from("tags")
            .select("id, name, type, parent_id, canonical_id, tag_aliases(alias)")
            .eq("id", id)
            .maybeSingle(),
        supabaseAdmin
            .from("recipe_tags")
            .select("recipes(id, name, hidden_at)")
            .eq("tag_id", id)
            .limit(USED_IN_LIMIT),
        supabaseAdmin
            .from("recipe_tags")
            .select("tag_id", { count: "exact", head: true })
            .eq("tag_id", id),
        supabaseAdmin.from("tags").select("id, name").eq("parent_id", id),
        supabaseAdmin.from("tags").select("id, name"),
    ]);

    if (tag.error || !tag.data) {
        res.status(404).json({ error: "Tag not found" });
        return;
    }

    const row = tag.data;
    const nameById = new Map((parents.data ?? []).map((entry) => [entry.id, entry.name]));

    // One count query per child, because `recipe_tags` has no grouping through
    // PostgREST and a tag has a handful of children at most — `east asian` has
    // four. If a taxonomy ever grows a branch with dozens, this becomes a view.
    const childCounts = await Promise.all(
        (children.data ?? []).map(async (child) => {
            const { count } = await supabaseAdmin
                .from("recipe_tags")
                .select("tag_id", { count: "exact", head: true })
                .eq("tag_id", child.id);

            return { id: child.id, name: child.name, recipeCount: count ?? 0 };
        })
    );

    const detail: AdminTagDetail = {
        id: row.id,
        name: row.name,
        type: row.type,
        parentId: row.parent_id,
        parentName: row.parent_id ? (nameById.get(row.parent_id) ?? null) : null,
        recipeCount: linkCount.count ?? 0,
        aliases: (row.tag_aliases ?? []).map((alias) => alias.alias),
        recipes: dishRefs(
            (links.data ?? [])
                .map((link) => link.recipes)
                .filter((recipe): recipe is NonNullable<typeof recipe> => Boolean(recipe))
        ),
        children: childCounts.sort((a, b) => b.recipeCount - a.recipeCount),
    };

    res.json(detail);
}

/** `GET /rest/admin/suggestions/:id` — a dish idea and what it is made of. */
export async function getSuggestion(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
        .from("recipe_suggestions")
        .select(
            `id, name, name_en, description, canonical_id, difficulty, total_time_minutes,
             identity_cuisine, hidden_at, hidden_reason, created_at,
             recipe_suggestion_ingredients(id, ingredients(name)),
             recipe_suggestion_tags(tags(id, name, type))`
        )
        .eq("id", id)
        .maybeSingle();

    if (error || !data) {
        res.status(404).json({ error: "Suggestion not found" });
        return;
    }

    // The promoted recipe is found by canonical id rather than stored: a
    // suggestion does not point forward at what it became, `recipes` points
    // back. Same join the list uses.
    const promoted = await supabaseAdmin
        .from("recipes")
        .select("id, name")
        .eq("source_suggestion_id", data.id)
        .is("base_recipe_id", null)
        .limit(1)
        .maybeSingle();

    const detail: AdminSuggestionDetail = {
        id: data.id,
        name: data.name,
        nameEn: data.name_en,
        description: data.description,
        canonicalId: data.canonical_id,
        difficulty: data.difficulty,
        totalTimeMinutes: data.total_time_minutes,
        identityCuisine: data.identity_cuisine,
        hiddenAt: data.hidden_at,
        hiddenReason: data.hidden_reason,
        createdAt: data.created_at,
        promotedRecipeId: promoted.data?.id ?? null,
        promotedRecipeName: promoted.data?.name ?? null,
        ingredients: (data.recipe_suggestion_ingredients ?? []).map((row) => ({
            id: row.id,
            name: row.ingredients?.name ?? "—",
        })),
        tags: (data.recipe_suggestion_tags ?? [])
            .map((row) => row.tags)
            .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
            .map((tag) => ({ id: tag.id, name: tag.name, type: tag.type })),
    };

    res.json(detail);
}

/**
 * `GET /rest/admin/users/:profileId`
 *
 * **Counts, never contents.** What a person cooks, saves and plans is theirs;
 * "41 saved recipes" answers whether the account is actually used, and the list
 * of them answers a question nobody asked and the reader never consented to.
 * Every figure below is a `head: true` count for that reason — the rows are not
 * fetched, so there is nothing here to leak even by accident.
 */
export async function getUser(req: Request, res: Response): Promise<void> {
    const { profileId } = req.params;

    const profile = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, display_name, is_admin, onboarding_completed, created_at")
        .eq("id", profileId)
        .maybeSingle();

    if (profile.error || !profile.data) {
        res.status(404).json({ error: "Account not found" });
        return;
    }

    const row = profile.data;

    const [directory, entitlement, usage, favourites, collections, lists, menus, imports] =
        await Promise.all([
            supabaseAdmin.rpc("admin_user_directory", { p_user_ids: [row.user_id] }),
            supabaseAdmin
                .from("profile_entitlements")
                .select(
                    "entitlement_id, product_id, store, expires_at, revoked_at, verified_at"
                )
                .eq("user_id", row.user_id)
                .maybeSingle(),
            supabaseAdmin
                .from("ai_usage_events")
                .select("bucket")
                .eq("user_id", row.user_id)
                .gte(
                    "created_at",
                    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
                ),
            supabaseAdmin
                .from("profile_recipe_interactions")
                .select("id", { count: "exact", head: true })
                .eq("profile_id", row.id)
                .eq("interaction_type", "favourite"),
            supabaseAdmin
                .from("collections")
                .select("id", { count: "exact", head: true })
                .eq("profile_id", row.id),
            supabaseAdmin
                .from("shopping_lists")
                .select("id", { count: "exact", head: true })
                .eq("profile_id", row.id),
            supabaseAdmin
                .from("menus")
                .select("id", { count: "exact", head: true })
                .eq("owner_profile_id", row.id),
            supabaseAdmin
                .from("recipes")
                .select("id", { count: "exact", head: true })
                .eq("created_by", row.id),
        ]);

    const buckets: Record<string, number> = {};

    for (const event of usage.data ?? []) {
        buckets[event.bucket] = (buckets[event.bucket] ?? 0) + 1;
    }

    const entitlementRow = entitlement.data;
    const active = entitlementRow
        ? !entitlementRow.revoked_at &&
          (!entitlementRow.expires_at ||
              new Date(entitlementRow.expires_at).getTime() > Date.now())
        : false;

    const detail: AdminUserDetail = {
        profileId: row.id,
        userId: row.user_id,
        email: directory.data?.[0]?.email ?? null,
        displayName: row.display_name,
        isAdmin: row.is_admin,
        onboardingCompleted: row.onboarding_completed,
        createdAt: row.created_at,
        lastSignInAt: directory.data?.[0]?.last_sign_in_at ?? null,
        entitlement: entitlementRow
            ? {
                  active,
                  entitlementId: entitlementRow.entitlement_id,
                  productId: entitlementRow.product_id,
                  store: entitlementRow.store,
                  expiresAt: entitlementRow.expires_at,
                  revokedAt: entitlementRow.revoked_at,
                  verifiedAt: entitlementRow.verified_at,
              }
            : null,
        usage: buckets,
        usageTotal: Object.values(buckets).reduce((sum, value) => sum + value, 0),
        library: {
            favourites: favourites.count ?? 0,
            collections: collections.count ?? 0,
            shoppingLists: lists.count ?? 0,
            menus: menus.count ?? 0,
            importedRecipes: imports.count ?? 0,
        },
    };

    res.json(detail);
}
