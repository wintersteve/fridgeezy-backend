import {
    fetchQuotaStatus,
    recordAiUsage,
    type QuotaBucket,
} from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

import { isAuthDisabled } from "./require-auth";
import { isEntitlementRequired } from "./require-entitlement";

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /**
             * Present only on a metered route, put there by {@link requireQuota}.
             * See {@link QuotaHandle}.
             */
            quota?: QuotaHandle;
        }
    }
}

export interface QuotaHandle {
    bucket: QuotaBucket;
    /**
     * Do not charge for this request after all.
     *
     * For the reuse shortcuts, which are the whole reason charging is not
     * unconditional: promoting an already-promoted suggestion returns the
     * finished row and `modify` returns an existing variant, and neither runs a
     * model. Charging a cook for a recipe we already had is the one thing that
     * makes a quota feel dishonest, and it is invisible from out here — only the
     * use case knows it took the shortcut.
     */
    waive: () => void;
}

/** Which bucket, if any, a request has been charged against. */
interface QuotaState {
    bucket: QuotaBucket;
    userId: string;
    waived: boolean;
    charged: boolean;
}

const STATE = new WeakMap<Request, QuotaState>();

/**
 * Meters a route against a free account's monthly allowance.
 *
 * ## Why this exists beside `requireEntitlement` rather than instead of it
 *
 * The product's rule was "if a model runs, it is paid", which is enforceable and
 * converts badly: nobody without a subscription could experience a single model
 * call, so the paywall was a claim rather than a demonstration. This turns the
 * same gate into "here is your recipe, four left" and moves the ask onto
 * somebody who has already had value out of us — which is the moment
 * `requireEntitlement`'s own notes say is the most persuasive in the app.
 *
 * Both middlewares still exist and mean different things:
 *
 * - `requireEntitlement` — you may not do this at all without paying.
 * - `requireQuota` — you may do this N times, then you must pay.
 *
 * A metered mount is therefore `tier: "account"`, and **every route under it
 * must carry one of the two.** A route carrying neither is free forever, which
 * is exactly the failure the `subscriber` default was designed to prevent — so
 * `assertMeteredMountsAreGated` (`rest/index.ts`) refuses to boot on one.
 *
 * ## 402, and the client already knows what to do with it
 *
 * The same status as an entitlement refusal, deliberately: `useSSEStream` and
 * `postBackendJson` in the app both turn 402 into the unlock sheet, so an
 * exhausted quota lands on the paywall with no new client plumbing. The BODY is
 * what differs — `reason: "quota"` plus the bucket and when it resets — so the
 * sheet can say "you have used your 5 recipes this month" instead of the wrong
 * sentence, "subscribe to write recipes".
 *
 * ## Charging happens on the way OUT, on success
 *
 * A quota that charges on arrival bills for failures, which is the fastest way
 * to make one feel like a swindle. So this checks before, and records after —
 * on `res.finish`, and only for a 2xx.
 *
 * The honest limit of that rule: an SSE route writes its 200 before the first
 * model call, so a generation that dies mid-stream still counts. That is the
 * lesser evil in both directions — the call was made and did cost us, and the
 * alternative is a hook in twelve use cases that silently stops charging the
 * day one of them forgets it. What is NOT left to chance is the reuse
 * shortcuts, which take a model call's price for no model call at all; those
 * call {@link QuotaHandle.waive} explicitly.
 *
 * ## It stands down with `REQUIRE_ENTITLEMENT`
 *
 * Same switch, and it has to be: metering while purchasing is not shipped would
 * wall every user at five recipes with no way to buy more. Turning the paid gate
 * on is what turns this on.
 */
export function requireQuota(bucket: QuotaBucket) {
    async function handle(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (!isEntitlementRequired() || isAuthDisabled()) {
            next();
            return;
        }

        const userId = req.supabaseUserId;

        if (!userId) {
            // Reachable only by attaching this to a route that is not behind
            // `requireSupabaseUser`. A wiring bug, not a client one, and it must
            // not read as "out of quota".
            console.error(
                `[quota] no user on request — ${req.method} ${req.originalUrl}`
            );

            res.status(500).json({ error: "Quota check misconfigured" });
            return;
        }

        let status;

        try {
            status = await fetchQuotaStatus(userId);
        } catch (cause) {
            // Same reasoning as the entitlement middleware's 503: a database
            // that cannot answer is not evidence that somebody has spent their
            // allowance, and telling a subscriber they are out because a query
            // failed is the worst outcome available.
            console.error("[quota] lookup failed", cause);

            res.status(503).json({ error: "Quota check unavailable" });
            return;
        }

        const entry = status.find((row) => row.bucket === bucket);

        if (!entry) {
            // A bucket with no row in `ai_quota_limits` — a half-applied
            // migration. Fail OPEN with a shout: the alternative is refusing
            // paying customers because a config row is missing.
            console.error(
                `[quota] no limit configured for "${bucket}" — allowing`
            );

            next();
            return;
        }

        if (entry.used >= entry.allowance) {
            console.warn(
                `[quota] exhausted: ${req.method} ${req.originalUrl} — ${bucket} ${entry.used}/${entry.allowance} (${entry.tier})`
            );

            res.status(402).json({
                error: "Quota exhausted",
                // Read by the client to pick which sentence the unlock sheet
                // says. An entitlement refusal carries no `reason`, so an older
                // build simply shows the subscription copy it always did.
                reason: "quota",
                bucket,
                used: entry.used,
                allowance: entry.allowance,
                tier: entry.tier,
                resetsAt: entry.periodEnd,
            });
            return;
        }

        const state: QuotaState = {
            bucket,
            userId,
            waived: false,
            charged: false,
        };

        STATE.set(req, state);

        req.quota = {
            bucket,
            waive: () => {
                state.waived = true;
            },
        };

        // `finish` fires once the response has been fully flushed, for a
        // buffered JSON reply and for a closed SSE stream alike. `close` is not
        // used: it also fires when the client hangs up mid-stream, and a reader
        // who backgrounds the app should not be billed for a generation the
        // background job is still finishing.
        res.on("finish", () => {
            if (state.waived || state.charged) return;
            if (res.statusCode < 200 || res.statusCode >= 300) return;

            state.charged = true;

            void recordAiUsage(
                state.userId,
                state.bucket,
                `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`
            ).catch((cause) => {
                // Swallowed on purpose. The user has already had their recipe;
                // taking it back because the bookkeeping failed is the wrong
                // trade, and the cost of the opposite mistake is one uncounted
                // call.
                console.error("[quota] failed to record usage", cause);
            });
        });

        next();
    }

    /**
     * How `collectRoutes` recognises this in a handler stack, so the startup
     * banner can mark metered routes and `assertMeteredMountsAreGated` can prove
     * no route under an `account` mount is ungated.
     *
     * A property rather than the function's name, for the reason
     * `requireEntitlement.isEntitlementGate` records: esbuild may rename a local
     * binding in the Lambda bundle, and the symptom would be a banner reporting
     * zero metered routes while the gate was in fact enforcing.
     */
    handle.isQuotaGate = true as const;
    handle.quotaBucket = bucket;

    return handle;
}

/**
 * Do not charge this request, from inside a use case.
 *
 * The handlers `createStreamHandler` builds are handed an `IncomingMessage`
 * rather than an Express `Request`, so the cast lives here once instead of at
 * every call site. A no-op on an unmetered route, which is what lets a use case
 * call it unconditionally on its reuse path without knowing how it was mounted.
 */
export function waiveQuota(req: unknown): void {
    (req as { quota?: QuotaHandle }).quota?.waive();
}
