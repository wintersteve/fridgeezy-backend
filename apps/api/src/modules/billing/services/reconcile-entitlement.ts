import {
    findEntitlementByUserId,
    isEntitlementActive,
    saveVerifiedEntitlement,
    type ProfileEntitlement,
} from "@fridgeezy/supabase";

import {
    fetchRevenueCatEntitlement,
    isReconcileEnabled,
} from "./revenuecat-subscriber";

/**
 * How long a verified row is taken on trust.
 *
 * The window is what this costs: at most one RevenueCat call per user per
 * fifteen minutes, and only for users who HOLD an entitlement — a free account
 * never reaches the stale path at all. Fifteen minutes is chosen against what
 * being wrong costs in each direction: a refund or a transfer that never
 * reached us leaves someone entitled for up to a window, which is nothing
 * against the month the row would otherwise have claimed; and shortening it
 * buys accuracy nobody can perceive, since the only reader is a gate on a
 * request that has to happen anyway.
 */
const VERIFY_TTL_MS = 15 * 60 * 1000;

/**
 * The floor between RevenueCat calls for one user, whatever the mode.
 *
 * Separate from the TTL because the two bound different things. The TTL bounds
 * the age of a FACT; this bounds the RATE of asking, and it is what stands
 * between an unentitled account retrying a refused request in a loop and a
 * RevenueCat call per attempt.
 */
const MIN_INTERVAL_MS = 30 * 1000;

/**
 * Per-process, and deliberately not in the database.
 *
 * It is a rate bound, not a correctness mechanism: a Lambda cold start empties
 * it, and two concurrent instances each keep their own. Both are fine, because
 * the worst outcome of a miss is one extra RevenueCat read — whereas a shared
 * record of every attempt would be a write on the hot path to save a read on a
 * cold one.
 */
const lastAttempt = new Map<string, number>();

/**
 * Checks currently in flight, so a second caller WAITS rather than being
 * throttled out by the first.
 *
 * This is the difference between the feature working and the bug it was built
 * to fix reappearing one layer down. A purchase produces two callers within
 * milliseconds: the app's customer-info listener posting `/billing/reconcile`,
 * and — the moment the unlock sheet closes — the parked request it was blocking,
 * arriving at a gate that is about to refuse it. With only a rate bound, the
 * second is dropped because the first is "recent", and the user watches the
 * paywall reopen on the subscription they have just bought.
 *
 * Awaiting is correct rather than merely convenient: both callers want the same
 * answer about the same user at the same instant, so the second one's job is
 * finished by the first one's read.
 */
const inFlight = new Map<string, Promise<void>>();

/** Bounded so a long-lived instance cannot grow this without limit. */
const MAX_TRACKED = 5000;

function throttled(userId: string, now: number): boolean {
    const previous = lastAttempt.get(userId);

    return previous !== undefined && now - previous < MIN_INTERVAL_MS;
}

function recordAttempt(userId: string, now: number): void {
    if (lastAttempt.size >= MAX_TRACKED) lastAttempt.clear();

    lastAttempt.set(userId, now);
}

/**
 * Runs one check per user at a time, and hands concurrent callers the same one.
 *
 * The promise is removed in a `finally` so a failure does not pin every later
 * caller to it — a RevenueCat outage must cost each request one attempt, not
 * leave a rejected promise cached as the answer.
 */
async function checkOnce(userId: string): Promise<void> {
    const existing = inFlight.get(userId);

    if (existing) {
        // Failures are the caller's to log; here a shared check that threw
        // simply means this caller did not get a fresher row either.
        await existing.catch(() => undefined);
        return;
    }

    if (inFlight.size >= MAX_TRACKED) inFlight.clear();

    const run = (async () => {
        const snapshot = await fetchRevenueCatEntitlement(userId);

        await saveVerifiedEntitlement(snapshot);
    })();

    inFlight.set(userId, run);

    try {
        await run;
    } finally {
        inFlight.delete(userId);
    }
}

/**
 * When a check is worth making.
 *
 * - `stale` — the row claims access and has not been confirmed inside the TTL.
 *   This is the direction the webhook alone cannot cover: nothing re-asks, so a
 *   row is believed until its own `expires_at`, however wrong that date is.
 * - `refused` — the caller is about to be told no. Bounded to exactly the
 *   requests that would otherwise fail, which is what makes it free on the
 *   common path, and it is what closes the purchase-to-webhook window: somebody
 *   who paid two seconds ago is entitled at RevenueCat before the event reaches
 *   us.
 * - `requested` — the app asked, because the RevenueCat SDK on the device saw
 *   the customer change. The device is a TRIGGER and never a source: it says
 *   "look again", and what is written comes from RevenueCat, so a client
 *   claiming a subscription it does not have gains nothing.
 */
export type ReconcileMode = "stale" | "refused" | "requested";

export interface ReconcileResult {
    /** The row as it now stands, after any write. */
    entitlement: ProfileEntitlement | null;
    /** Whether RevenueCat was actually asked. */
    checked: boolean;
}

/**
 * Brings `profile_entitlements` back in line with RevenueCat.
 *
 * Takes the row the caller has already read — every caller has one — so that
 * the common case where nothing needs checking costs no second select.
 *
 * **Throws** on a RevenueCat or database failure. {@link refreshEntitlement} is
 * the form the gates use; this one is for the route, where somebody is waiting
 * on the answer and a failure has to be reported rather than absorbed.
 */
export async function reconcileEntitlement(
    userId: string,
    mode: ReconcileMode,
    existing: ProfileEntitlement | null
): Promise<ReconcileResult> {
    if (!isReconcileEnabled()) {
        return { entitlement: existing, checked: false };
    }

    const now = Date.now();
    const active = isEntitlementActive(existing);

    if (mode === "stale") {
        if (!active) return { entitlement: existing, checked: false };

        const verifiedAt = existing?.verified_at
            ? new Date(existing.verified_at).getTime()
            : 0;

        if (now - verifiedAt < VERIFY_TTL_MS) {
            return { entitlement: existing, checked: false };
        }
    }

    // An active row means the refusal was not about the entitlement — a
    // subscriber meeting their fair-use ceiling, say — so there is nothing here
    // to correct.
    if (mode === "refused" && active) {
        return { entitlement: existing, checked: false };
    }

    // A check already running for this user is joined rather than skipped — see
    // `inFlight`. The throttle applies only when there is nothing to wait for.
    if (!inFlight.has(userId) && throttled(userId, now)) {
        return { entitlement: existing, checked: false };
    }

    recordAttempt(userId, now);

    await checkOnce(userId);

    // Re-read rather than reconstructing the row from the snapshot: the write is
    // an upsert whose result the database owns, and every caller goes on to
    // apply `isEntitlementActive` to what comes back.
    return { entitlement: await findEntitlementByUserId(userId), checked: true };
}

/**
 * The form the gates use: never throws, and falls back to what was already read.
 *
 * A verification that could not be made is not evidence about anybody's
 * subscription. Returning the row unchanged is what keeps a RevenueCat outage,
 * a rotated key or a slow response from turning into a paying user being
 * refused — which is the one failure this whole module must not introduce while
 * fixing the opposite one.
 *
 * Separate from the throwing form rather than a flag on it, because the two
 * have genuinely different contracts and the wrong one is silent.
 */
export async function refreshEntitlement(
    userId: string,
    mode: ReconcileMode,
    existing: ProfileEntitlement | null
): Promise<ProfileEntitlement | null> {
    try {
        const result = await reconcileEntitlement(userId, mode, existing);

        return result.entitlement;
    } catch (cause) {
        console.error(`[billing] reconcile (${mode}) failed`, cause);

        return existing;
    }
}
