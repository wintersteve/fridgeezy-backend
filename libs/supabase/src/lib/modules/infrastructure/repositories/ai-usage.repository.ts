import { Database } from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

/** The three things a metered request can spend. Mirrors the SQL enum. */
export type QuotaBucket = Database["public"]["Enums"]["ai_quota_bucket"];

export type QuotaTier = "account" | "subscriber";

export interface QuotaStatus {
    bucket: QuotaBucket;
    used: number;
    allowance: number;
    tier: QuotaTier;
    periodStart: string;
    periodEnd: string;
}

/**
 * What one user has spent this period, per bucket.
 *
 * **The arithmetic is NOT reimplemented here.** It is one `security definer`
 * function in SQL (`ai_quota_status_for`), and the client reads its
 * caller-scoped twin (`ai_quota_status`) for the rows it draws in Settings — so
 * there is exactly one definition of "how many are left". Two copies that
 * disagree is the worst failure this feature has: a client promising two more
 * recipes while the server answers 402. Compare `entitlement_is_active` /
 * `isEntitlementActive`, which are two copies and say so loudly because they
 * have to be.
 *
 * Throws rather than returning an empty list. "No rows" and "the database is
 * unreachable" must not collapse: the middleware turns the first into a 402 and
 * the second into a 503, and a paying user must never be told they are out of
 * recipes because a query failed.
 */
export async function fetchQuotaStatus(userId: string): Promise<QuotaStatus[]> {
    const { data, error } = await supabaseAdmin.rpc("ai_quota_status_for", {
        p_user_id: userId,
    });

    if (error) {
        throw new Error(`Failed to read quota: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
        bucket: row.bucket,
        used: row.used,
        allowance: row.allowance,
        tier: row.tier as QuotaTier,
        periodStart: row.period_start,
        periodEnd: row.period_end,
    }));
}

/**
 * Records one charged model call.
 *
 * Append-only: there is no update and no delete anywhere in this repository,
 * which is what makes the count auditable when somebody disputes it. RLS denies
 * every write to the client roles, so this is reachable only through the service
 * role.
 *
 * A failure here is logged and swallowed by the caller rather than failing the
 * request — see `requireQuota`. The user has already had their recipe; taking it
 * away because the bookkeeping failed is the wrong trade, and the cost of the
 * opposite mistake is one uncounted call.
 */
export async function recordAiUsage(
    userId: string,
    bucket: QuotaBucket,
    route: string
): Promise<void> {
    const { error } = await supabaseAdmin
        .from("ai_usage_events")
        .insert({ user_id: userId, bucket, route });

    if (error) {
        throw new Error(`Failed to record AI usage: ${error.message}`);
    }
}
