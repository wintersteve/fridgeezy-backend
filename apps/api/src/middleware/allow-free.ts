import type { NextFunction, Request, Response } from "express";

/**
 * Declares that a route under a `metered` mount is deliberately free.
 *
 * `assertMeteredMountsAreGated` refuses to boot when a route under such a mount
 * carries neither `requireQuota` nor `requireEntitlement`. That check exists so
 * that FORGETTING a gate cannot give an AI feature away, and it is exactly
 * right — but it has only ever admitted two answers to "what does this cost",
 * and there is a third: nothing, on purpose.
 *
 * `POST /recipes/:recipeId/pairings` is the case that forced it. It reads a
 * cached pairing set and never runs a model; the generation that fills that
 * cache is a separate route and carries `requireQuota`. Metering the read would
 * be wrong in a way that is easy to miss: `requireQuota` CHECKS before the
 * handler runs, so a reader who had spent their allowance would be answered 402
 * for a read that costs nothing — the compose sheet would stop opening for the
 * people most likely to have used it.
 *
 * ## Why a middleware rather than an exemption list
 *
 * The mount table's own note says an open route means "writing it down where it
 * is visible in a diff and in the startup banner". A list of paths in
 * `rest/index.ts` satisfies neither well: it drifts away from the route it
 * describes, it matches by string, and a renamed path silently stops being
 * exempt — or, worse, silently keeps exempting a path that no longer exists
 * while the new one boots ungated.
 *
 * Attached to the route, it is impossible to read the routing without reading
 * the claim, and impossible to move the route without moving it. The `reason`
 * is required for the same purpose: this is a declaration somebody has to be
 * able to argue with later.
 *
 * **It is not a gate and grants nothing.** The mount's own
 * `requireSupabaseUser` still applies, so the caller is still authenticated;
 * this only records that no further cost applies. A route that does run a model
 * must never carry it.
 */
export function allowFree(reason: string) {
    if (!reason.trim()) {
        throw new Error(
            "allowFree: a free route has to say why it is free — the reason is read by whoever audits this next."
        );
    }

    function handle(_req: Request, _res: Response, next: NextFunction) {
        next();
    }

    /**
     * How `collectRoutes` recognises this in a handler stack.
     *
     * A property rather than the function's name, for the reason
     * `requireQuota`'s own marker records: esbuild may rename a local binding in
     * the Lambda bundle, and the symptom would be a boot failure in production
     * that no local run reproduces.
     */
    handle.isFreeDeclaration = true as const;
    handle.freeReason = reason;

    return handle;
}
