import { timingSafeEqual } from "node:crypto";

import { parseJsonBodyBuffered } from "@fridgeezy/streaming-server";
import { applyEntitlementEvent } from "@fridgeezy/supabase";
import { Request, Response } from "express";
import { z } from "zod/v4";

/**
 * One RevenueCat webhook event, narrowed to the fields this stores.
 *
 * Local to this module rather than in `libs/schemas`: that library is packed
 * into a tarball the client installs, and the client has no business knowing the
 * shape of a server-to-server event.
 *
 * `passthrough` is load-bearing — RevenueCat adds fields to this payload over
 * time, and a strict schema would start rejecting live events on their release
 * schedule rather than ours.
 */
const RevenueCatEventSchema = z
    .object({
        id: z.string(),
        type: z.string(),
        app_user_id: z.string(),
        event_timestamp_ms: z.number(),
        product_id: z.string().nullish(),
        entitlement_ids: z.array(z.string()).nullish(),
        expiration_at_ms: z.number().nullish(),
        store: z.string().nullish(),
        environment: z.string().nullish(),
    })
    .loose();

const RevenueCatWebhookSchema = z.object({ event: RevenueCatEventSchema }).loose();

/**
 * Event types that END access before its expiry.
 *
 * Everything else either grants or extends, and `EXPIRATION` needs no entry at
 * all — it carries an `expiration_at_ms` in the past, so the derived activity
 * rule already reports it inactive.
 *
 * **`CANCELLATION` is deliberately not here.** On both stores cancelling turns
 * off auto-renew and the subscription runs to its paid-for expiry. Revoking on
 * cancellation would cut off a user who has paid for the rest of the month — the
 * single most damaging thing this handler could get wrong, and the easiest to
 * get wrong, because the word says otherwise. `BILLING_ISSUE` is likewise not
 * here: it opens a grace period, and the expiry already encodes when that ends.
 *
 * `SUBSCRIPTION_PAUSED` is Android-only and currently unreachable — the client's
 * `REVENUECAT_API_KEY` has no Android value — but revoking is the right reading
 * of a pause, so it is handled rather than left to be discovered on launch day.
 */
const REVOKING_EVENTS = new Set(["REFUND", "SUBSCRIPTION_PAUSED"]);

/** Sent by the dashboard's "send test event" button. Acknowledge, store nothing. */
const TEST_EVENT = "TEST";

/**
 * A subscription moving between accounts.
 *
 * **Deliberately not handled, and acknowledged rather than retried.** A transfer
 * carries `transferred_from` and `transferred_to` arrays, and the top-level
 * `app_user_id` does not reliably identify which side this event is about —
 * so the generic path would be a coin flip between revoking a paying user and
 * granting a non-paying one. Both are worse than doing nothing: doing nothing
 * leaves the previous state, which is right for one side and stale for the
 * other until its next event.
 *
 * Transfers happen when someone restores purchases onto a second account. Rare,
 * but not hypothetical. Handle it properly when there is a real payload to read
 * — guessing at the shape from documentation is what this comment exists to
 * prevent.
 */
const TRANSFER_EVENT = "TRANSFER";

/**
 * Constant-time comparison of the configured secret against the one presented.
 *
 * RevenueCat does **not** HMAC-sign its webhooks the way Stripe does — it sends
 * back, verbatim, whatever `Authorization` header value you configure on the
 * webhook in its dashboard. So verification is a shared-secret comparison and
 * the secret is the entire protection: there is no body signature, which means a
 * leaked value lets anyone forge any subscription state. Treat it like a
 * password, and note that it must be set in the RevenueCat dashboard *and* in
 * SSM, with no mechanism to tell you the two have drifted apart other than every
 * event failing.
 */
function isAuthorized(presented: string | undefined): boolean {
    const expected = process.env.REVENUECAT_WEBHOOK_SECRET;

    if (!expected || !presented) return false;

    const a = Buffer.from(expected);
    const b = Buffer.from(presented);

    // `timingSafeEqual` throws on a length mismatch, so the lengths have to be
    // compared first. That leaks the secret's length and nothing else, which is
    // the standard and accepted shape of this check.
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Receives RevenueCat subscription events and records the resulting entitlement.
 *
 * **This is a public route** — mounted through `publicRouter` because RevenueCat
 * cannot hold a Supabase session, exactly like the share page. Unlike the share
 * page it *writes*, so being reachable is not the same as being safe: the shared
 * secret above is what stands in for the auth gate, and it is checked before the
 * body is even read.
 *
 * **Status codes are control flow here, not decoration.** RevenueCat retries any
 * non-2xx with backoff for hours, so:
 * - a bad secret is 401 — it will retry, and it should, because the usual cause
 *   is a secret rotated on one side only;
 * - an unparseable body is 400 and is NOT retried usefully, but returning 200
 *   would hide a real integration break;
 * - a database failure is 500 **on purpose**, so the retry redelivers it. This
 *   is the case where returning 200 loses a purchase permanently.
 */
export async function revenuecatWebhook(req: Request, res: Response) {
    if (!isAuthorized(req.headers.authorization)) {
        console.warn("[billing] webhook rejected: bad or missing secret");
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    let payload: unknown;

    try {
        // The app mounts no `express.json()` — handlers read the raw stream
        // themselves (see `express-app.ts`) — so this has to parse the body.
        payload = await parseJsonBodyBuffered(req);
    } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
    }

    const parsed = RevenueCatWebhookSchema.safeParse(payload);

    if (!parsed.success) {
        console.error("[billing] webhook payload did not parse", parsed.error);
        res.status(400).json({ error: "Invalid payload" });
        return;
    }

    const event = parsed.data.event;

    if (event.type === TEST_EVENT) {
        console.log("[billing] test event acknowledged");
        res.status(200).json({ received: true });
        return;
    }

    if (event.type === TRANSFER_EVENT) {
        // Acknowledged, not retried: redelivering an event we have decided not
        // to interpret just burns RevenueCat's backoff schedule. Logged at error
        // level because it needs a human, not because anything failed.
        console.error(
            `[billing] TRANSFER received and NOT applied — ${JSON.stringify(event)}`
        );

        res.status(200).json({ received: true });
        return;
    }

    const revoking = REVOKING_EVENTS.has(event.type);

    try {
        const applied = await applyEntitlementEvent({
            userId: event.app_user_id,
            entitlementId: event.entitlement_ids?.[0] ?? null,
            productId: event.product_id ?? null,
            store: event.store ?? null,
            environment: event.environment ?? null,
            expiresAt: event.expiration_at_ms
                ? new Date(event.expiration_at_ms)
                : null,
            revokedAt: revoking ? new Date() : null,
            eventId: event.id,
            eventAt: new Date(event.event_timestamp_ms),
        });

        console.log(
            `[billing] ${event.type} for ${event.app_user_id} — ${
                applied ? "applied" : "ignored (duplicate or stale)"
            }`
        );

        res.status(200).json({ received: true });
    } catch (cause) {
        // 500 so RevenueCat redelivers. A 200 here would acknowledge an event
        // that was never stored, and there is no second chance at it.
        console.error("[billing] failed to apply event", cause);
        res.status(500).json({ error: "Failed to record entitlement" });
    }
}
