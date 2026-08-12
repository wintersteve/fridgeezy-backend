import { supabaseAdmin } from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

/**
 * Escape hatch for local work against `curl`, deliberately verbose to type and
 * to read in a diff. There is no positive `AUTH_REQUIRED` flag on purpose:
 * enforcement is the default, so forgetting to set anything is the safe outcome
 * rather than the unsafe one.
 *
 * Exported so `requireEntitlement` can stand down on the same signal rather than
 * testing the variable itself. It has to know: with no auth there is no user id,
 * and an entitlement cannot be looked up for nobody.
 */
export function isAuthDisabled(): boolean {
    return process.env.ALLOW_UNAUTHENTICATED === "true";
}

function unauthorized(res: Response, reason: string): void {
    // A bare 401 with no body: the client cannot act on the distinction between
    // "no header", "malformed header" and "rejected token", and spelling it out
    // tells an attacker which of the three they got. The reason is logged
    // instead, where it is useful and not reachable.
    console.warn(`[auth] rejected: ${reason}`);

    res.status(401).json({ error: "Unauthorized" });
}

/**
 * Rejects any request that does not carry a valid Supabase access token.
 *
 * This is what stands between the Function URL and the app's LLM spend. The URL
 * itself is `AuthType: NONE` and has to stay that way — Lambda's only other
 * option is `AWS_IAM`, which requires the caller to hold AWS credentials and
 * SigV4-sign every request, and a published React Native binary cannot hold a
 * credential it does not immediately leak. Cognito could issue temporary ones,
 * but that is a second identity system beside the Supabase one the app already
 * has. So the gate lives here, in the app, one hop later.
 *
 * `getUser()` is a network round trip to Supabase rather than a local signature
 * check. That is the right trade here: it costs ~50-100ms on requests that go on
 * to spend seconds in an LLM, and unlike local verification it honours a signed
 * out or deleted user immediately.
 */
export async function requireSupabaseUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    if (isAuthDisabled()) {
        next();
        return;
    }

    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
        unauthorized(res, `${req.method} ${req.originalUrl} — no bearer token`);
        return;
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
        unauthorized(res, `${req.method} ${req.originalUrl} — empty bearer token`);
        return;
    }

    try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !data.user) {
            unauthorized(res, `${req.method} ${req.originalUrl} — ${error?.message ?? "no user"}`);
            return;
        }

        // Handed to `requireEntitlement` and anything else downstream, so the
        // subject is resolved once per request rather than per middleware — this
        // is a network round trip, not a local decode.
        req.supabaseUserId = data.user.id;

        next();
    } catch (cause) {
        // Supabase being unreachable is a 503, not a 401: the caller may well be
        // authenticated and there is nothing for them to fix by signing in again.
        console.error("[auth] verification failed", cause);

        res.status(503).json({ error: "Authentication unavailable" });
    }
}
