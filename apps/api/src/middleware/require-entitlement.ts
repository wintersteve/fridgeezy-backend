import {
    findEntitlementByUserId,
    isEntitlementActive,
} from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

/**
 * Whether the paid gate is live.
 *
 * **This one is opt-IN, and that inverts `ALLOW_UNAUTHENTICATED` deliberately.**
 * There, enforcement is the default because forgetting to set a variable must
 * fail closed. Here, failing closed means every request from the app returns 402
 * — because the client's purchase flow is still commented out
 * (`subscription-screen.tsx`), so today *nobody* can obtain an entitlement.
 * Enabling this before the client can sell a subscription does not protect the
 * spend, it takes the product offline.
 *
 * So this is a rollout switch for a feature that is not live yet, which is the
 * one kind of flag this repo keeps (see CLAUDE.md: "Build a flag scoped to a
 * risky change, not as a standing fixture"). **Flip it on in the same release
 * that ships purchasing, then delete the flag and make the gate
 * unconditional.** Leaving it as a permanent setting is how it ends up off in
 * production with nothing to say so — which is why the startup banner reports
 * the state rather than staying quiet about it.
 */
export function isEntitlementRequired(): boolean {
    return process.env.REQUIRE_ENTITLEMENT === "true";
}

/**
 * Rejects a request from a user with no active subscription.
 *
 * Runs *after* `requireSupabaseUser` and reads the id that middleware resolved,
 * so the pair costs one Supabase round trip plus one indexed select rather than
 * two round trips.
 *
 * **402, not 401.** The two are different instructions to the client: 401 means
 * "sign in again", 402 means "you are who you say you are and this needs a
 * subscription". Collapsing them sends a paying user who lapsed to the login
 * screen, and the client cannot tell it should show the paywall instead.
 *
 * ## Known gap: the purchase-to-webhook window
 *
 * A user who has just paid is entitled according to the RevenueCat SDK on their
 * device seconds before the webhook reaches us, so this can return 402 to
 * someone who genuinely just bought a subscription. RevenueCat delivers in a
 * second or two in practice, but it is not synchronous with the purchase and
 * there is no ordering guarantee.
 *
 * The fix, when it is worth building, is a fallback read of RevenueCat's REST
 * API on a miss — authoritative, and bounded to users who have no active row, so
 * it costs nothing on the common path. It is deliberately NOT built here: it
 * needs a sixth SSM secret and its own failure handling, and it is unmeasurable
 * until real purchases exist. Recorded in TODOS.md rather than left to be
 * rediscovered as a support ticket.
 */
export async function requireEntitlement(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    if (!isEntitlementRequired()) {
        next();
        return;
    }

    const userId = req.supabaseUserId;

    if (!userId) {
        // Only reachable by mounting this without `requireSupabaseUser` in front
        // of it, which the MOUNTS loop makes impossible — so this is a wiring
        // bug, not a client one, and it must not read as "not subscribed".
        console.error(
            `[entitlement] no user on request — ${req.method} ${req.originalUrl}`
        );

        res.status(500).json({ error: "Entitlement check misconfigured" });
        return;
    }

    try {
        const entitlement = await findEntitlementByUserId(userId);

        if (!isEntitlementActive(entitlement)) {
            console.warn(
                `[entitlement] rejected: ${req.method} ${req.originalUrl} — ${
                    entitlement ? "inactive" : "no entitlement"
                }`
            );

            res.status(402).json({ error: "Subscription required" });
            return;
        }

        next();
    } catch (cause) {
        // Same reasoning as the auth middleware's 503: a database that cannot
        // answer is not evidence the user has not paid, and telling a subscriber
        // to buy again because a query failed is the worst outcome available.
        console.error("[entitlement] lookup failed", cause);

        res.status(503).json({ error: "Entitlement check unavailable" });
    }
}
