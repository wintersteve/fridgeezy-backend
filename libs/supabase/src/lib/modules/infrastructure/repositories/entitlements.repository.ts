import { ProfileEntitlement } from "@fridgeezy/types";

/**
 * Re-exported so a caller of these functions can name what they return without
 * taking a direct dependency on `@fridgeezy/types`. The API holds one on its
 * entitlement path and nowhere else, and adding a package dependency for a
 * single row type is more coupling than the type is worth.
 */
export type { ProfileEntitlement };

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

/**
 * What RevenueCat itself says about a user, as read from its REST API.
 *
 * Distinct from {@link EntitlementUpsert} because it carries no event: this is
 * a SNAPSHOT of current state rather than news of a change, which is what makes
 * the two writers behave differently below.
 */
export interface EntitlementSnapshot {
    userId: string;
    entitlementId: string | null;
    productId: string | null;
    store: string | null;
    environment: string | null;
    /** Null for a grant with no known expiry — a lifetime purchase. */
    expiresAt: Date | null;
    /** RevenueCat knows of no entitlement for this user at all. */
    absent: boolean;
}

/**
 * Records what RevenueCat currently reports, and stamps `verified_at`.
 *
 * ## Why this is not `applyEntitlementEvent`
 *
 * That function applies NEWS and guards on ordering: a stale event must not move
 * `expires_at` backwards and revoke a subscription that has since renewed. This
 * one applies TRUTH — a read of the live subscriber, taken just now — so the
 * ordering guard would be exactly backwards here. A row holding a month-old
 * event is precisely what this exists to correct, and refusing to write because
 * the row is newer than nothing would make it a no-op.
 *
 * It therefore leaves `last_event_id` and `last_event_at` **alone**. Those
 * describe the last event the webhook applied and are what the ordering guard
 * reads; a reconciler that stamped them would start rejecting real events that
 * legitimately follow it.
 *
 * ## The race, stated rather than pretended away
 *
 * A webhook can land between the REST read and this write, in which case this
 * overwrites a fresher fact with a one-second-older one. Both come from
 * RevenueCat and say the same thing in every case but a state change inside that
 * window, and the next verification corrects it. What is NOT tolerable is the
 * reverse — a write that silently did nothing — which is why there is no
 * optimistic guard here.
 *
 * ## `absent` writes an expiry, never a deletion
 *
 * RevenueCat reporting no entitlement is not evidence the row is wrong to exist;
 * it is evidence that whatever it granted has ended. Expiring keeps the product,
 * the store and the history readable, and it goes through the same derived
 * activity rule as everything else. A `revoked_at` would be a stronger claim
 * than the read supports — that is for a refund or a transfer, which arrive as
 * events.
 */
export async function saveVerifiedEntitlement(
    input: EntitlementSnapshot,
    verifiedAt: Date = new Date()
): Promise<void> {
    const existing = await findEntitlementByUserId(input.userId);

    // Nothing here and nothing there: no row to correct, and writing an empty
    // one would invent a subscription history for somebody who has never had
    // one. The common case for a free account, so it must cost no write.
    if (input.absent && !existing) return;

    if (input.absent) {
        const { error } = await supabaseAdmin
            .from("profile_entitlements")
            .update({
                expires_at: verifiedAt.toISOString(),
                verified_at: verifiedAt.toISOString(),
                updated_at: verifiedAt.toISOString(),
            })
            .eq("user_id", input.userId);

        if (error) {
            throw new Error(`Failed to expire entitlement: ${error.message}`);
        }

        return;
    }

    const { error } = await supabaseAdmin.from("profile_entitlements").upsert(
        {
            user_id: input.userId,
            entitlement_id: input.entitlementId,
            product_id: input.productId,
            store: input.store,
            environment: input.environment,
            expires_at: input.expiresAt?.toISOString() ?? null,
            // A subscription RevenueCat currently grants is not revoked,
            // whatever the row said before. This is the path that gives a
            // wrongly-revoked user their access back.
            revoked_at: null,
            verified_at: verifiedAt.toISOString(),
            updated_at: verifiedAt.toISOString(),
        },
        { onConflict: "user_id" }
    );

    if (error) {
        throw new Error(`Failed to store entitlement: ${error.message}`);
    }
}
