import {
    findEntitlementByUserId,
    isEntitlementActive,
} from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

import { isAuthDisabled } from "./require-auth";

/**
 * Whether the paid gate is live.
 *
 * **This one is opt-IN, and that inverts `ALLOW_UNAUTHENTICATED` deliberately.**
 * There, enforcement is the default because forgetting to set a variable must
 * fail closed. Here, failing closed would put the paywall in front of routes the
 * product now gives away — see the tier split on `requireEntitlement` below.
 *
 * So this is a rollout switch, which is the one kind of flag this repo keeps
 * (see CLAUDE.md: "Build a flag scoped to a risky change, not as a standing
 * fixture"). **Flip it on in the same release that ships purchasing, then delete
 * the flag and make the gate unconditional.** Leaving it as a permanent setting
 * is how it ends up off in production with nothing to say so — which is why the
 * startup banner reports the state rather than staying quiet about it.
 */
export function isEntitlementRequired(): boolean {
    return process.env.REQUIRE_ENTITLEMENT === "true";
}

/**
 * Rejects a request from a user with no active subscription.
 *
 * ## Attach this per ROUTE, not per mount
 *
 * It used to run on every mount except `billing`, which made "signed in" and
 * "subscribed" the same thing and left no tier in between. The product now has
 * three:
 *
 * - **guest** — reads the catalog straight from Supabase, never reaches this API
 * - **account** — every prompt: generate, chat, extract, substitutes, modify
 * - **subscriber** — premium surfaces, currently just `POST /recipes/:id/compose`
 *
 * A mount cannot express that, because the split runs *through* the recipes
 * module rather than between modules. So the gate moved onto the route:
 *
 * ```ts
 * router.post("/:recipeId/compose", requireEntitlement, RecipesController.compose);
 * ```
 *
 * Note what that costs, because it is the opposite of how `requireSupabaseUser`
 * works. Authentication is applied by the MOUNTS loop precisely so a new module
 * *cannot* be added unauthenticated by accident; premium is now an addition
 * someone has to remember. The failure directions differ — forgetting auth is a
 * security hole, forgetting this gives a premium route away — and the compromise
 * is that the startup banner derives `← premium` from {@link isEntitlementGate}
 * and counts it, so a route that lost its gate is visible on every boot rather
 * than only in the diff that dropped it. **If you add a premium route, check the
 * banner.**
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

    // Auth off means no user id was ever resolved, so there is nobody to look an
    // entitlement up for. Stand down rather than answering 500: both flags are
    // local escape hatches, and `ALLOW_UNAUTHENTICATED=true` with
    // `REQUIRE_ENTITLEMENT=true` used to make every premium route fail as
    // "misconfigured" — a combination that was rare while entitlement was
    // all-or-nothing and is ordinary now that only some routes carry it.
    // Disabling auth in production is a far louder problem than the paywall
    // following it, and the banner already shouts about that one.
    if (isAuthDisabled()) {
        next();
        return;
    }

    const userId = req.supabaseUserId;

    if (!userId) {
        // Reachable only by attaching this to a route that is not behind
        // `requireSupabaseUser` — the MOUNTS loop puts every feature router
        // behind it, so this is a wiring bug, not a client one, and it must not
        // read as "not subscribed".
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

/**
 * How `collectRoutes` recognises this middleware in a route's handler stack, so
 * the banner can mark premium routes without a second list to keep in step.
 *
 * A **property**, not the function's name. `handle.name === "requireEntitlement"`
 * reads more directly and would work in dev, then quietly stop working in the
 * bundle the Lambda actually runs — esbuild is free to rename a local binding,
 * and the symptom would be a banner reporting zero premium routes while the gate
 * was in fact enforcing. A property survives minification because it is data.
 */
requireEntitlement.isEntitlementGate = true as const;
