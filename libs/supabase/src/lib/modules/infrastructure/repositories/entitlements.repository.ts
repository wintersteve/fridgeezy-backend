import { ProfileEntitlement } from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

/**
 * The subset of a RevenueCat event this repository stores.
 *
 * Named separately from `ProfileEntitlementInsertPayload` because the webhook
 * never supplies `id`, `created_at` or `updated_at`, and `userId` is resolved
 * from the event's `app_user_id` rather than being a free field.
 */
export interface EntitlementUpsert {
    userId: string;
    entitlementId: string | null;
    productId: string | null;
    store: string | null;
    environment: string | null;
    /** Null for a grant with no known expiry — a lifetime purchase. */
    expiresAt: Date | null;
    /** Set only when access ends early: a refund or a transfer away. */
    revokedAt: Date | null;
    eventId: string;
    eventAt: Date;
}

/**
 * Entitlement reads and writes.
 *
 * Deliberately not built on a `@fridgeezy/domain` interface, unlike the six
 * repositories beside it. Those model the food domain and are consumed by a
 * pipeline that benefits from the seam; this is one table with one reader (the
 * API's entitlement middleware) and one writer (the RevenueCat webhook), and an
 * interface with a single implementation would be ceremony rather than a seam.
 * Promote it if a second consumer ever appears — that is the moment, not before.
 */
export async function findEntitlementByUserId(
    userId: string
): Promise<ProfileEntitlement | null> {
    const { data, error } = await supabaseAdmin
        .from("profile_entitlements")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        // Thrown rather than returned as a null: "no row" and "the database is
        // unreachable" must not collapse into the same value here, because the
        // caller turns the first into a 402 and the second into a 503. A user
        // who has paid should never be told to pay again because a query failed.
        throw new Error(`Failed to read entitlement: ${error.message}`);
    }

    return data;
}

/**
 * Applies one RevenueCat event.
 *
 * Idempotent and order-independent, which the webhook cannot be without help:
 * RevenueCat retries on any non-2xx and does not promise ordered delivery, so
 * the same event can arrive twice and an older one can arrive after a newer one.
 * Re-applying a duplicate is harmless; applying a *stale* event is not — it
 * would move `expires_at` backwards and revoke a subscription that has since
 * renewed. Both are rejected here rather than at the call site so that every
 * writer inherits the guard.
 *
 * Returns whether the event was applied, so the handler can log the difference
 * between "stored" and "ignored as stale" instead of reporting both as success.
 */
export async function applyEntitlementEvent(
    input: EntitlementUpsert
): Promise<boolean> {
    const existing = await findEntitlementByUserId(input.userId);

    if (existing) {
        if (existing.last_event_id === input.eventId) {
            return false;
        }

        // Strictly older loses. Equal timestamps are applied: RevenueCat stamps
        // to the millisecond and two genuinely distinct events can share one, so
        // dropping ties would silently discard a real state change.
        if (
            existing.last_event_at &&
            new Date(existing.last_event_at) > input.eventAt
        ) {
            return false;
        }
    }

    const { error } = await supabaseAdmin.from("profile_entitlements").upsert(
        {
            user_id: input.userId,
            entitlement_id: input.entitlementId,
            product_id: input.productId,
            store: input.store,
            environment: input.environment,
            expires_at: input.expiresAt?.toISOString() ?? null,
            revoked_at: input.revokedAt?.toISOString() ?? null,
            last_event_id: input.eventId,
            last_event_at: input.eventAt.toISOString(),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
    );

    if (error) {
        throw new Error(`Failed to store entitlement: ${error.message}`);
    }

    return true;
}

/**
 * Whether a row currently grants access.
 *
 * **This must stay in step with `entitlement_is_active()` in
 * `20260806000004_profile_entitlements.sql`** — same rule, two languages,
 * because the API answers this per request in TypeScript and SQL callers need
 * it in a query. A divergence here does not error; it silently lets the wrong
 * people in or keeps the right ones out.
 *
 * Activity is derived rather than stored so that a missed EXPIRATION webhook
 * costs a late revocation instead of an indefinite free ride. `expires_at` of
 * null means no known expiry — a lifetime grant — not "expired".
 */
export function isEntitlementActive(
    entitlement: ProfileEntitlement | null,
    now: Date = new Date()
): boolean {
    if (!entitlement) return false;
    if (entitlement.revoked_at) return false;
    if (!entitlement.expires_at) return true;

    return new Date(entitlement.expires_at) > now;
}
