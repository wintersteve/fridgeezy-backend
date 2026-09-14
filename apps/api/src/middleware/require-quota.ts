import {
    fetchQuotaStatus,
    findEntitlementByUserId,
    isEntitlementActive,
    recordAiUsage,
    type QuotaBucket,
} from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

import {
    isReconcileEnabled,
    refreshEntitlement,
} from "../modules/billing/services";

import { isAuthDisabled } from "./require-auth";

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
 * ## It stands down only with `ALLOW_UNAUTHENTICATED`
 *
 * It used to stand down with `REQUIRE_ENTITLEMENT` as well, and had to: metering
 * while purchasing was not shipped would have walled every user at five recipes
 * with no way to buy more. That flag is gone (2026-09-04, see
 * {@link requireEntitlement}), so metering is now on wherever auth is — which is
 * what makes `ai_usage_events` fill at all. It was empty for three weeks because
 * this returned on the first line.
 *
 * With auth off there is no user id to charge, so there is nothing to do but
 * pass. That is a local escape hatch and the banner shouts about it.
 */
export function requireQuota(bucket: QuotaBucket) {
    async function handle(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (isAuthDisabled()) {
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

        // Before the allowance is read, because the allowance DEPENDS on it:
        // `ai_quota_status` joins `ai_quota_limits` on the tier
        // `entitlement_is_active` derives, so a row still claiming a lapsed
        // subscription hands out the subscriber ceiling — 60 recipes a week
        // against a free account's 2 — while the client, reading the same RPC,
        // draws no allowance at all and the two disagree in the user's favour.
        // Bounded to users who hold an entitlement and to one RevenueCat read
        // per TTL, and it never throws.
        let stored;

        try {
            // Guarded rather than left to `refreshEntitlement` to no-op, because
            // the READ is the cost here: this runs on every metered request, and
            // a deployment with no RevenueCat key would be paying an extra
            // select per AI call for a check it cannot make.
            if (isReconcileEnabled()) {
                stored = await findEntitlementByUserId(userId);

                await refreshEntitlement(userId, "stale", stored);
            }
        } catch (cause) {
            // The read failing is not a reason to refuse anybody: the RPC below
            // makes its own decision from the database, and this was only ever
            // an attempt to make that decision a fresher one.
            console.error("[quota] entitlement refresh failed", cause);
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

        let entry = status.find((row) => row.bucket === bucket);

        // A free account at its limit is exactly who may have just subscribed,
        // and the webhook can be a second or two behind the purchase — the
        // purchase-to-webhook window TODOS.md recorded as shipped open. Asked
        // only here, at the moment of refusal, so it costs nothing on the path
        // everybody else takes; `refused` mode declines to ask at all for a
        // caller who already holds an active row, which is a subscriber meeting
        // their fair-use ceiling.
        if (entry && entry.used >= entry.allowance && entry.tier !== "subscriber") {
            const verified = await refreshEntitlement(
                userId,
                "refused",
                stored ?? null
            );

            // Re-read rather than adjusting the entry in hand: the tier decides
            // which `ai_quota_limits` row applies, so a subscription that has
            // just been confirmed changes the ALLOWANCE, not merely the verdict.
            if (isEntitlementActive(verified)) {
                try {
                    status = await fetchQuotaStatus(userId);
                    entry = status.find((row) => row.bucket === bucket);

                    if (entry && entry.used < entry.allowance) {
                        console.log(
                            `[quota] admitted after reconcile — ${req.method} ${req.originalUrl}`
                        );
                    }
                } catch (cause) {
                    // Keep the first answer. It is the one the user was always
                    // going to get, and refusing with a 503 instead would be a
                    // worse reply to a request we had already decided.
                    console.error("[quota] re-check after reconcile failed", cause);
                }
            }
        }

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
