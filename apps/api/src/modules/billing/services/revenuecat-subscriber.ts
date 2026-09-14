import type { EntitlementSnapshot } from "@fridgeezy/supabase";

/**
 * RevenueCat's REST API, read as the source of truth for one subscriber.
 *
 * The webhook is news; this is the record. Everything else in this module
 * exists because a webhook can be missed, delayed, delivered to a URL this
 * process is not behind (every local stack), or simply never sent for an event
 * nobody triggered — and until now nothing ever re-asked.
 */
const API_BASE = "https://api.revenuecat.com/v1";

/**
 * Bounded, because this sits in front of a request somebody is waiting on. A
 * RevenueCat outage must cost a few seconds and then fall back to the stored
 * row, never a hung gate.
 */
const TIMEOUT_MS = 5000;

/**
 * The v1 SECRET key, which is not the key the app holds.
 *
 * The client's `EXPO_PUBLIC_REVENUECAT_*` keys are public and can only read the
 * device's own customer. This one can read any subscriber, so it belongs in SSM
 * beside the webhook secret and never in a bundle.
 *
 * **Its absence is the off switch, and that is deliberate rather than a flag.**
 * A flag named `RECONCILE_ENTITLEMENTS` would be a second thing to get wrong;
 * this cannot be set to a value that lies. Two consequences worth knowing:
 *
 * - Production without the key behaves exactly as it did before this module
 *   existed — webhooks only. The startup banner says so on every boot.
 * - A local stack keeps the entitlement `infra/send-webhook-event.sh`
 *   fabricated for it. With the key set, that row is correctly expired on the
 *   first check, because RevenueCat has never heard of the purchase behind it.
 *   Set the key locally when you want the truth; leave it unset when you want a
 *   subscription to test with.
 */
export function isReconcileEnabled(): boolean {
    return Boolean(process.env.REVENUECAT_SECRET_API_KEY);
}

interface RevenueCatEntitlement {
    expires_date?: string | null;
    grace_period_expires_date?: string | null;
    product_identifier?: string | null;
}

interface RevenueCatSubscription {
    store?: string | null;
    is_sandbox?: boolean | null;
}

interface RevenueCatSubscriber {
    entitlements?: Record<string, RevenueCatEntitlement> | null;
    subscriptions?: Record<string, RevenueCatSubscription> | null;
}

/** Milliseconds, or `Infinity` for a grant with no expiry. */
function effectiveExpiry(entitlement: RevenueCatEntitlement): number {
    // A billing-issue grace period is still access. Taking the later of the two
    // is what stops a card that failed this morning reading as a lapse while
    // RevenueCat is still granting the entitlement.
    const dates = [
        entitlement.expires_date,
        entitlement.grace_period_expires_date,
    ].filter((value): value is string => Boolean(value));

    if (dates.length === 0) return Number.POSITIVE_INFINITY;

    return Math.max(...dates.map((value) => new Date(value).getTime()));
}

/**
 * Reads one subscriber and reduces it to the row this app stores.
 *
 * Picks the entitlement that grants access LONGEST rather than one named in a
 * constant. The stored row answers a single question — is this person entitled
 * — and `entitlement_is_active` reads it as "any unexpired grant", so the
 * furthest expiry is the one that decides. It also means a second tier can be
 * added in the dashboard without a deploy here.
 *
 * **A trial needs no special case**, which is the answer to the obvious worry:
 * RevenueCat reports an introductory offer as an ordinary entitlement with an
 * expiry, so a trial starting, converting or lapsing is the same three writes as
 * any subscription. `period_type` is deliberately not read — nothing downstream
 * has a different rule for trial access, and reading it would invite one.
 */
export async function fetchRevenueCatEntitlement(
    userId: string
): Promise<EntitlementSnapshot> {
    const key = process.env.REVENUECAT_SECRET_API_KEY;

    if (!key) {
        throw new Error("REVENUECAT_SECRET_API_KEY is not configured");
    }

    const response = await fetch(
        `${API_BASE}/subscribers/${encodeURIComponent(userId)}`,
        {
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        }
    );

    // RevenueCat creates a subscriber on read, so a 404 means the id was
    // malformed rather than unknown. Either way it holds no entitlement, and
    // treating it as absent is the honest reading — a user id this API cannot
    // resolve is not one to grant access to.
    if (response.status === 404) {
        return absentSnapshot(userId);
    }

    if (!response.ok) {
        // Thrown, not swallowed: every caller falls back to the stored row, and
        // a 401 here (a rotated or mistyped key) must be loud rather than
        // silently degrade into "nobody is subscribed".
        throw new Error(
            `RevenueCat responded ${response.status} for subscriber lookup`
        );
    }

    const body = (await response.json()) as {
        subscriber?: RevenueCatSubscriber | null;
    };

    const entitlements = Object.entries(body.subscriber?.entitlements ?? {});

    if (entitlements.length === 0) {
        return absentSnapshot(userId);
    }

    const [entitlementId, entitlement] = entitlements.reduce((best, current) =>
        effectiveExpiry(current[1]) > effectiveExpiry(best[1]) ? current : best
    );

    const expiry = effectiveExpiry(entitlement);

    const productId = entitlement.product_identifier ?? null;

    const subscription = productId
        ? body.subscriber?.subscriptions?.[productId]
        : undefined;

    return {
        userId,
        entitlementId,
        productId,
        // Normalised to the webhook's spelling. The REST API says `app_store`
        // and an event says `APP_STORE`, and one column holding both would make
        // every query on it wrong half the time.
        store: subscription?.store ? subscription.store.toUpperCase() : null,
        // `is_sandbox` is absent for a non-subscription (a lifetime unlock), so
        // null rather than a guess of PRODUCTION.
        environment:
            subscription?.is_sandbox === undefined ||
            subscription.is_sandbox === null
                ? null
                : subscription.is_sandbox
                  ? "SANDBOX"
                  : "PRODUCTION",
        expiresAt: Number.isFinite(expiry) ? new Date(expiry) : null,
        absent: false,
    };
}

function absentSnapshot(userId: string): EntitlementSnapshot {
    return {
        userId,
        entitlementId: null,
        productId: null,
        store: null,
        environment: null,
        expiresAt: null,
        absent: true,
    };
}
