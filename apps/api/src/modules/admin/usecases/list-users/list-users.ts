import {
    AdminUserFilterSchema,
    AdminUserUpdateSchema,
    type AdminUserRow,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { likeTerm, parseBody, parseQuery, toPage } from "../../services";

/** Usage is reported over this window, on both the directory and the overview. */
const USAGE_WINDOW_DAYS = 30;

const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * Every AI call in the window, for the given accounts or for all of them.
 *
 * One function because the ranking pass and the page's own column want the
 * same rows, and two copies of "which events count as usage" is how a header
 * comes to disagree with the number under it.
 */
async function readUsage(userIds?: string[]) {
    let query = supabaseAdmin
        .from("ai_usage_events")
        .select("user_id, bucket")
        .gte("created_at", daysAgo(USAGE_WINDOW_DAYS));

    if (userIds) query = query.in("user_id", userIds);

    return query;
}

/**
 * Calls per account, tallied once.
 *
 * A comparator that counted the event list per comparison would walk every
 * event a few thousand times to order a few hundred accounts; the map is built
 * once and read in constant time.
 */
function tally(events: { user_id: string }[]): Map<string, number> {
    const counts = new Map<string, number>();

    for (const event of events) {
        counts.set(event.user_id, (counts.get(event.user_id) ?? 0) + 1);
    }

    return counts;
}

/**
 * Whether an entitlement row grants access right now.
 *
 * Mirrors `entitlement_is_active` in the database rather than calling it,
 * because the row is already in hand and an RPC per user is a round trip for a
 * comparison. The rule is the same one the gate applies: not revoked, and
 * either no expiry or one in the future.
 *
 * **It is a reading of the row, never a question put to RevenueCat.** The
 * console must not reconcile — `reconcileEntitlement` is triggered by a
 * purchase, a refused gate or the device's own listener, and having an admin
 * page fire it would mean opening a list of two hundred users re-verified two
 * hundred subscriptions against RevenueCat's API. What the console shows is
 * what the server believes, which is exactly the thing worth looking at when
 * somebody reports that it is wrong.
 */
function isEntitlementActive(row: {
    revoked_at: string | null;
    expires_at: string | null;
}): boolean {
    if (row.revoked_at) return false;
    if (!row.expires_at) return true;

    return new Date(row.expires_at).getTime() > Date.now();
}

/**
 * `GET /rest/admin/users` — who has an account, what they pay for, what they use.
 *
 * Three sources joined in memory, because they live in three places the
 * database cannot join across a PostgREST request: `profiles` (public schema),
 * `auth.users` (reached through `admin_user_directory`, which exists for
 * exactly this) and `profile_entitlements` (keyed on the AUTH user id, not the
 * profile id — a distinction that has to be right or every subscription lands
 * on the wrong person).
 *
 * ## Searching by email is a second pass, and it is bounded
 *
 * `profiles` holds no email, so a query term is matched against the display
 * name first and then against the emails of the page's own users. That means a
 * search for an address only finds someone already on the page being looked
 * at. Stated rather than hidden: the honest fix is a search that goes through
 * `admin_user_directory` the other way round, which this did not need for a
 * directory one person reads.
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminUserFilterSchema, req, res);

    if (!filter) return;

    let query = supabaseAdmin
        .from("profiles")
        .select("id, user_id, display_name, is_admin, onboarding_completed, created_at", {
            count: "exact",
        });

    if (filter.query) {
        query = query.ilike("display_name", likeTerm(filter.query));
    }

    const ascending = filter.dir === "asc";
    // Ranking by usage has to see every account before it can place one, so on
    // that branch the page is taken after the sort rather than by the database
    // — the same trade `listTags` records for its own count column. Ordering by
    // `created_at` underneath it is still worth doing: it is the tiebreaker
    // between accounts that have used nothing, which is most of them.
    const usageSort = filter.sort === "aiCalls";

    const ordered = query
        .order("created_at", { ascending: usageSort ? false : ascending })
        .order("id", { ascending: true });

    const { data, error, count } = usageSort
        ? await ordered
        : await ordered.range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listUsers failed", error);
        res.status(500).json({ error: "Could not list users" });
        return;
    }

    const all = data ?? [];

    if (all.length === 0) {
        res.json(toPage([], count, filter));
        return;
    }

    // Read once for everybody when the ranking needs it, and the SAME map then
    // fills the page's own usage column — a second read scoped to the page
    // would be the same rows again.
    //
    // Deliberately NOT filtered by `user_id` on this branch: PostgREST puts
    // `in` lists in the query string, and every account's id is exactly the
    // shape that reaches **414 URI Too Long** at a few hundred rows.
    const rankingUsage = usageSort ? await readUsage() : undefined;
    const rank = tally(rankingUsage?.data ?? []);

    const profiles = usageSort
        ? [...all]
              .sort((a, b) => {
                  const difference =
                      (rank.get(a.user_id) ?? 0) - (rank.get(b.user_id) ?? 0);

                  return ascending ? difference : -difference;
              })
              .slice(filter.offset, filter.offset + filter.limit)
        : all;

    const userIds = profiles.map((profile) => profile.user_id);

    const [directory, entitlements, usage] = await Promise.all([
        supabaseAdmin.rpc("admin_user_directory", { p_user_ids: userIds }),
        supabaseAdmin
            .from("profile_entitlements")
            .select("user_id, entitlement_id, product_id, store, expires_at, revoked_at, verified_at")
            .in("user_id", userIds),
        rankingUsage ? Promise.resolve(rankingUsage) : readUsage(userIds),
    ]);

    if (directory.error) {
        // Not fatal: the directory is a nicety and the rest of the row is real.
        // A page that refuses to draw because one email could not be read is
        // worse than a page with a blank email column.
        console.error("[admin] admin_user_directory failed", directory.error);
    }

    const authById = new Map(
        (directory.data ?? []).map((entry) => [entry.user_id, entry])
    );
    const entitlementById = new Map(
        (entitlements.data ?? []).map((entry) => [entry.user_id, entry])
    );

    const usageByUser = new Map<string, Record<string, number>>();

    for (const event of usage.data ?? []) {
        const buckets = usageByUser.get(event.user_id) ?? {};

        buckets[event.bucket] = (buckets[event.bucket] ?? 0) + 1;
        usageByUser.set(event.user_id, buckets);
    }

    let rows: AdminUserRow[] = profiles.map((profile) => {
        const entitlement = entitlementById.get(profile.user_id);

        return {
            profileId: profile.id,
            userId: profile.user_id,
            email: authById.get(profile.user_id)?.email ?? null,
            displayName: profile.display_name,
            isAdmin: profile.is_admin,
            onboardingCompleted: profile.onboarding_completed,
            createdAt: profile.created_at,
            lastSignInAt: authById.get(profile.user_id)?.last_sign_in_at ?? null,
            entitlement: entitlement
                ? {
                      active: isEntitlementActive(entitlement),
                      entitlementId: entitlement.entitlement_id,
                      productId: entitlement.product_id,
                      store: entitlement.store,
                      expiresAt: entitlement.expires_at,
                      revokedAt: entitlement.revoked_at,
                      verifiedAt: entitlement.verified_at,
                  }
                : null,
            usage: usageByUser.get(profile.user_id) ?? {},
        };
    });

    if (filter.query) {
        // The display-name filter ran in the database; this widens the same
        // page to an email match rather than replacing it, so a term that hit a
        // name still shows that row.
        const term = filter.query.toLowerCase();

        rows = rows.filter(
            (row) =>
                row.displayName?.toLowerCase().includes(term) ||
                row.email?.toLowerCase().includes(term)
        );
    }

    if (filter.subscription === "active") {
        rows = rows.filter((row) => row.entitlement?.active);
    }

    if (filter.subscription === "none") {
        rows = rows.filter((row) => !row.entitlement?.active);
    }

    res.json(toPage(rows, count, filter));
}

/**
 * `PATCH /rest/admin/users/:profileId` — grant or revoke the admin flag.
 *
 * The only write the console makes about a person, and the contract's own note
 * says why: their preferences, their diet and their saved recipes are theirs.
 *
 * ## An admin cannot remove their own flag
 *
 * Not paternalism — it is the only protection against locking everybody out.
 * There is no other door: `is_admin` is not client-writable (the column grant
 * sees to that), so the last admin who demoted themselves would need a psql
 * session against production to get back in. Demoting somebody ELSE is allowed,
 * including the last other admin, because that is a decision with a person
 * behind it rather than a slip.
 */
export async function updateUser(req: Request, res: Response): Promise<void> {
    const update = parseBody(AdminUserUpdateSchema, req, res);

    if (!update) return;

    if (req.params.profileId === req.adminProfileId && !update.isAdmin) {
        res.status(409).json({
            error: "You cannot remove your own admin access",
        });
        return;
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({ is_admin: update.isAdmin })
        .eq("id", req.params.profileId)
        .select("id, user_id")
        .maybeSingle();

    if (error) {
        console.error("[admin] updateUser failed", error);
        res.status(500).json({ error: "Could not update user" });
        return;
    }

    if (!data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    // Warn, not log: granting admin is the highest-privilege thing this API
    // does, and it should be findable in CloudWatch without knowing to look.
    console.warn(
        `[admin] ${req.adminProfileId} set is_admin=${update.isAdmin} on profile ${data.id}`
    );

    res.json({ updated: true });
}
