import type { AdminOverview } from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { isPubliclyServed } from "@fridgeezy/toolkit";
import type { Request, Response } from "express";

import { fetchRecipeArtIndex, isArtMissing } from "../../services";

const USAGE_WINDOW_DAYS = 7;
const NEW_USER_WINDOW_DAYS = 30;

const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/** A `head: true` count: PostgREST answers with a Content-Range and no body. */
const HEAD = { count: "exact" as const, head: true };

/**
 * The storage origin this deployment serves pictures from, or null on a local
 * stack.
 *
 * Null is what makes the unreachable-image count 0 in local development rather
 * than "nearly the whole catalogue": there, a private storage host is the
 * CORRECT stored value — it is what lets a phone on the same Wi-Fi load the
 * picture — so there is nothing to report. `isPubliclyServed` carries the full
 * reasoning and is shared with `repair-recipe-image-urls.ts`, so the console's
 * count and the repair's own cannot disagree about which rows are broken.
 */
const publicStorageOrigin = (): string | null => {
    const url = process.env.SUPABASE_URL;

    if (!url || !isPubliclyServed(url)) return null;

    return new URL(url).origin;
};

/**
 * `GET /rest/admin/overview` — what is in the catalogue, and what is wrong with it.
 *
 * ## Every figure here is either a total or a DEFECT
 *
 * "Recipes: 54" is a fact; "missing an image: 3" is a job. The screen is built
 * around the second kind, because a dashboard of totals is a thing you look at
 * once and a list of what is unfinished is a thing you come back to. The
 * console makes each defect count a link into the list already filtered to it.
 *
 * ## Fifteen counts, one round of requests
 *
 * All `head: true`, so nothing transfers, and issued together — they are
 * independent and the page waits on the slowest either way. The only two that
 * read rows are the usage tallies, which have no count-by-group in PostgREST
 * and are small over their windows.
 *
 * `ai_usage_events` is pruned by a trigger, so "rows in the last seven days" is
 * bounded by traffic rather than by the age of the deployment.
 */
export async function getOverview(_req: Request, res: Response): Promise<void> {
    const [
        recipesTotal,
        recipesDishes,
        recipesHidden,
        recipesMissingImage,
        recipesUnreachableImage,
        recipesImported,
        suggestionsTotal,
        suggestionsHidden,
        ingredientsTotal,
        ingredientsMissingShelfLife,
        ingredientsUnclassified,
        usersTotal,
        usersAdmins,
        usersRecent,
        entitlements,
        usage,
        promoted,
    ] = await Promise.all([
        supabaseAdmin.from("recipes").select("id", HEAD),
        // Dishes rather than rows: a variant is a reader's copy, not a catalogue
        // entry, and counting them here would make the catalogue look like it
        // grows every time somebody asks for a dairy-free version.
        supabaseAdmin.from("recipes").select("id", HEAD).is("base_recipe_id", null),
        supabaseAdmin.from("recipes").select("id", HEAD).not("hidden_at", "is", null),
        // Rows whose art is genuinely absent from the bucket. Read rather than
        // counted, because the question cannot be asked of the database at all
        // — see `recipe-art.ts` for why `image IS NULL` is not it. Two columns
        // over the whole table against one storage listing.
        supabaseAdmin.from("recipes").select("id, image"),
        // Non-null images NOT starting with this deployment's storage origin.
        // `like` with a trailing wildcard rather than a host comparison per row:
        // the whole point is to count without transferring 54 URLs, and the
        // origin is a literal prefix of every correct value.
        //
        // Resolved to a count of 0 on a local stack, where the origin is null —
        // and written as a resolved promise rather than a skipped query so the
        // destructuring below keeps one shape.
        publicStorageOrigin()
            ? supabaseAdmin
                  .from("recipes")
                  .select("id", HEAD)
                  .not("image", "is", null)
                  .not("image", "like", `${publicStorageOrigin()}%`)
            : Promise.resolve({ count: 0 }),
        supabaseAdmin.from("recipes").select("id", HEAD).eq("origin", "imported"),
        supabaseAdmin.from("recipe_suggestions").select("id", HEAD),
        supabaseAdmin
            .from("recipe_suggestions")
            .select("id", HEAD)
            .not("hidden_at", "is", null),
        supabaseAdmin.from("ingredients").select("id", HEAD),
        supabaseAdmin
            .from("ingredients")
            .select("id", HEAD)
            .is("default_shelf_life_days", null),
        supabaseAdmin.from("ingredients").select("id", HEAD).is("component_kind", null),
        supabaseAdmin.from("profiles").select("id", HEAD),
        supabaseAdmin.from("profiles").select("id", HEAD).eq("is_admin", true),
        supabaseAdmin
            .from("profiles")
            .select("id", HEAD)
            .gte("created_at", daysAgo(NEW_USER_WINDOW_DAYS)),
        // Read rather than counted, because "active" is derived from two
        // columns and a clock — the same rule `entitlement_is_active` applies —
        // and a `head` count cannot evaluate it.
        supabaseAdmin
            .from("profile_entitlements")
            .select("expires_at, revoked_at"),
        supabaseAdmin
            .from("ai_usage_events")
            .select("bucket")
            .gte("created_at", daysAgo(USAGE_WINDOW_DAYS)),
        // Which suggestions have a recipe behind them. One column over the
        // whole recipes table — a few thousand uuids at worst — against a
        // filter PostgREST cannot express across an unrelated table.
        supabaseAdmin
            .from("recipes")
            .select("source_suggestion_id")
            .not("source_suggestion_id", "is", null),
    ]);

    const artIndex = await fetchRecipeArtIndex();

    const missingArt = (recipesMissingImage.data ?? []).filter((row) =>
        isArtMissing(row.image, artIndex)
    ).length;

    const usageByBucket: Record<string, number> = {};

    for (const event of usage.data ?? []) {
        usageByBucket[event.bucket] = (usageByBucket[event.bucket] ?? 0) + 1;
    }

    const subscribers = (entitlements.data ?? []).filter(
        (row) =>
            !row.revoked_at &&
            (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
    ).length;

    const promotedIds = new Set(
        (promoted.data ?? []).map((row) => row.source_suggestion_id)
    );

    const body: AdminOverview = {
        recipes: {
            total: recipesTotal.count ?? 0,
            dishes: recipesDishes.count ?? 0,
            hidden: recipesHidden.count ?? 0,
            missingImage: missingArt,
            unreachableImage: recipesUnreachableImage.count ?? 0,
            imported: recipesImported.count ?? 0,
        },
        suggestions: {
            total: suggestionsTotal.count ?? 0,
            hidden: suggestionsHidden.count ?? 0,
            unpromoted: Math.max((suggestionsTotal.count ?? 0) - promotedIds.size, 0),
        },
        ingredients: {
            total: ingredientsTotal.count ?? 0,
            missingShelfLife: ingredientsMissingShelfLife.count ?? 0,
            unclassifiedComponent: ingredientsUnclassified.count ?? 0,
        },
        users: {
            total: usersTotal.count ?? 0,
            admins: usersAdmins.count ?? 0,
            subscribers,
            recent: usersRecent.count ?? 0,
        },
        usage: usageByBucket,
    };

    res.json(body);
}
