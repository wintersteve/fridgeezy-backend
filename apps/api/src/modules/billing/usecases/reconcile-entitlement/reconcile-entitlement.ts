import { findEntitlementByUserId, isEntitlementActive } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import {
    isReconcileEnabled,
    reconcileEntitlement,
} from "../../services";

/**
 * Re-checks the caller's subscription against RevenueCat, on request.
 *
 * ## Who calls this and why it is safe
 *
 * The app, from the RevenueCat SDK's `customerInfoUpdateListener` — the moment
 * the device learns its customer changed, which is a purchase completing, a
 * restore, a renewal, an expiry, or a refund landing. The device is a TRIGGER
 * and never a source: it carries no body, it names no entitlement, and what
 * gets written comes from RevenueCat's own API. A client claiming a
 * subscription it does not hold gains exactly nothing, which is what lets this
 * sit on an `account` mount with no further gate.
 *
 * ## What it closes that the webhook cannot
 *
 * The webhook is delivered to ONE configured URL, so nothing local ever
 * receives one, and in production a dropped event is believed until the row's
 * own `expires_at`. This is the path that makes the two agree within seconds
 * instead of weeks — in particular for the Settings usage card, which reads
 * `ai_quota_status()` in Supabase directly and never passes through a gate that
 * could have corrected the row on its way.
 *
 * `requested` mode, so the only bound is the per-user floor between RevenueCat
 * calls. It is a throttle, not a refusal: a call inside the window answers with
 * the row as it stands and `checked: false`, because the caller asked "is this
 * right" and the honest answer is what we know.
 */
export async function reconcileEntitlementRequest(
    req: Request,
    res: Response
): Promise<void> {
    const userId = req.supabaseUserId;

    if (!userId) {
        // Unreachable through the mount, which is behind `requireSupabaseUser`.
        // A wiring bug rather than a client one, so 500 rather than 401.
        res.status(500).json({ error: "Reconcile is misconfigured" });
        return;
    }

    const existing = await findEntitlementByUserId(userId);

    // Answered rather than 501'd: the client asks on every customer change and
    // has no way to know how the server is configured. `checked: false` is the
    // whole answer — it asked, nothing was verified, and here is what we hold.
    if (!isReconcileEnabled()) {
        res.status(200).json({
            active: isEntitlementActive(existing),
            expiresAt: existing?.expires_at ?? null,
            checked: false,
        });
        return;
    }

    try {
        const { entitlement, checked } = await reconcileEntitlement(
            userId,
            "requested",
            existing
        );

        res.status(200).json({
            active: isEntitlementActive(entitlement),
            expiresAt: entitlement?.expires_at ?? null,
            checked,
        });
    } catch (cause) {
        // 502, not 500: the failure is upstream, and the client's own
        // `CustomerInfo` is still the better answer for it to act on. It must
        // not read this as "you are not subscribed".
        console.error("[billing] reconcile request failed", cause);

        res.status(502).json({ error: "Could not reach RevenueCat" });
    }
}
