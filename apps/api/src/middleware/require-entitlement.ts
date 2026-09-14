import {
    findEntitlementByUserId,
    isEntitlementActive,
} from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

import { refreshEntitlement } from "../modules/billing/services";

import { isAuthDisabled } from "./require-auth";

/**
 * Rejects a request from a user with no active subscription.
 *
 * ## Attach this per MOUNT, via `tier`
 *
 * Declare it in `MOUNTS` (`rest/index.ts`) and let the loop apply it. `tier`
 * defaults to `subscriber`, so a new feature module is paid unless it says
 * otherwise — **forgetting fails closed.**
 *
 * The product's three tiers are:
 *
 * - **guest** — reads the catalog straight from Supabase, never reaches this API
 * - **account** — free surfaces that still need an owner or a session: speech
 *   synthesis, and reading or deleting your own prompt history
 * - **subscriber** — every AI feature: generate, promote, chat, modify,
 *   escalate, import, extract, substitutes, compose, voice commands
 *
 * This is the SECOND arrangement, and it went back to where it started. Before
 * 2026-08-12 the gate ran on every mount but `billing`, which made "signed in"
 * and "subscribed" the same thing. It then moved per-route, because the split
 * genuinely ran *through* the recipes module — `generate` free, `compose` paid —
 * and a mount cannot express that. On 2026-08-26 the product settled on "every
 * AI feature is paid", the split stopped running through any module but
 * `/speech`, and a mount could express it again.
 *
 * What that buys back is the property this file used to warn was missing.
 * Authentication is applied by the MOUNTS loop precisely so a module *cannot* be
 * added unauthenticated by accident; the paid gate now works the same way, and
 * the two failure directions no longer point opposite ways. An omission is safe
 * in both.
 *
 * ## The one exception, and how the banner still catches it
 *
 * `/speech` is `account` because synthesis is content-addressed — a step spoken
 * once is a storage read for every listener after — while `/speech/command` is
 * an uncached model call and carries this middleware directly. That is the only
 * per-route attachment left in the app.
 *
 * So the banner derives `← premium` from two sources that must agree: the mount
 * `tier` for a whole prefix, and {@link isEntitlementGate} for a route inside an
 * `account` mount. **If you add a premium route, check the banner** — a mount
 * that lost its tier reads as a block of missing marks on the next boot.
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
 * ## Unconditional, and there is no flag any more
 *
 * This ran behind `REQUIRE_ENTITLEMENT` from 2026-08-12 until 2026-09-04. That
 * was a rollout switch for a gate that could not be enforced yet — with nothing
 * to buy, enforcing returned 402 to everybody and took the product offline
 * rather than protecting the spend. It defaulted to OFF, in dev and in prod, so
 * for three weeks nothing was enforced and no usage was metered.
 *
 * What retired it is that there is now something to buy from both sides: real
 * App Store products against the store key, and RevenueCat's **Test Store**
 * (`EXPO_PUBLIC_REVENUECAT_TEST_KEY`) for local work, whose purchases go through
 * RevenueCat's own backend, grant the entitlement and fire a real webhook. The
 * app made the same call in the same direction — `paywall-override` defaults to
 * enforcing whenever a Test Store key is configured.
 *
 * **Do not reintroduce a flag.** A standing one is how enforcement ends up off
 * in production with nothing to say so, which is precisely what happened here.
 * The two remaining ways off the gate are both loud and both local:
 * `ALLOW_UNAUTHENTICATED=true` (below), and granting yourself an entitlement
 * with `infra/send-webhook-event.sh`, which now has a `TARGET=local` mode for
 * exactly this — the local stack never receives a real webhook, since RevenueCat
 * delivers to the deployed Function URL.
 *
 * ## The stored row is no longer the last word
 *
 * Until 2026-09-13 this read `profile_entitlements` and stopped there, which
 * made the webhook the only writer and therefore the only thing that could ever
 * be wrong. Two failures came out of that, in opposite directions, and
 * `reconcileEntitlement` answers both:
 *
 * - **The purchase-to-webhook window.** A user who has just paid is entitled
 *   according to the RevenueCat SDK on their device seconds before the event
 *   reaches us, so this returned 402 to somebody who had genuinely just bought.
 *   Now a refusal is checked against RevenueCat before it is sent, which is the
 *   fix TODOS.md described — bounded to callers with no active row, so it costs
 *   nothing on the common path.
 * - **A row that claims access it no longer has.** The derived activity rule
 *   self-heals only at the expiry the last event happened to carry, so a
 *   refund, a transfer or any dropped event is believed until that date. A row
 *   past its verification TTL is re-read from RevenueCat before it is trusted.
 *
 * Both are absorbed on failure: `refreshEntitlement` never throws, and a
 * verification that could not be made leaves the stored row exactly as it was.
 * Neither runs at all without `REVENUECAT_SECRET_API_KEY`, and the startup
 * banner says which mode the process is in.
 */
export async function requireEntitlement(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    // Auth off means no user id was ever resolved, so there is nobody to look an
    // entitlement up for. Stand down rather than answering 500:
    // `ALLOW_UNAUTHENTICATED=true` is the local escape hatch, and it used to
    // make every premium route fail as "misconfigured" instead. Disabling auth
    // in production is a far louder problem than the paywall following it, and
    // the banner already shouts about that one.
    //
    // **This is the only remaining way off the gate**, now that
    // `REQUIRE_ENTITLEMENT` is gone — see the note on {@link requireEntitlement}.
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
        const stored = await findEntitlementByUserId(userId);

        // A row that claims access and has not been confirmed lately. Bounded to
        // users who HOLD an entitlement and to one RevenueCat read per TTL, so
        // it costs nothing for everybody else — and it is the half the webhook
        // cannot do, since nothing otherwise re-asks before the date the last
        // event happened to carry.
        const entitlement = await refreshEntitlement(userId, "stale", stored);

        if (!isEntitlementActive(entitlement)) {
            // Last thing before the refusal, and only for a caller with no
            // active row: the purchase-to-webhook window is a real second or
            // two, and somebody who has just paid is entitled at RevenueCat
            // before the event reaches us. This is the gap TODOS.md recorded as
            // deliberately shipped open.
            const verified = await refreshEntitlement(
                userId,
                "refused",
                entitlement
            );

            if (isEntitlementActive(verified)) {
                console.log(
                    `[entitlement] admitted after reconcile — ${req.method} ${req.originalUrl}`
                );

                next();
                return;
            }

            console.warn(
                `[entitlement] rejected: ${req.method} ${req.originalUrl} — ${
                    verified ? "inactive" : "no entitlement"
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
