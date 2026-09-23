import { supabaseAdmin } from "@fridgeezy/supabase";
import type { NextFunction, Request, Response } from "express";

/**
 * The whole of the admin console's authorisation.
 *
 * Runs behind `requireSupabaseUser`, so the subject is already a verified
 * Supabase user and `req.supabaseUserId` is the id that verification produced —
 * never anything the caller sent. This reads one boolean against it.
 *
 * ## Why the flag is read here and not trusted from a token
 *
 * A custom JWT claim would save the round trip and would also be a claim minted
 * at sign-in: revoking an admin would then take effect whenever their access
 * token happened to expire. `requireSupabaseUser`'s own note takes the same
 * trade for the same reason — a network hop that honours a revocation
 * immediately beats a local decode that does not — and this hop rides on the
 * connection that one already opened.
 *
 * ## 404, not 403
 *
 * A non-admin is told the route does not exist. There is nothing for them to do
 * about a 403 and nothing for us to gain by confirming that an admin surface is
 * there to be attacked; the console is not linked from anywhere and its
 * hostname is the only thing that suggests it. The refusal is logged with the
 * user id, which is where it is actually useful.
 *
 * ## It does NOT stand down for ALLOW_UNAUTHENTICATED
 *
 * `requireSupabaseUser` has an escape hatch for local `curl` work, and this
 * deliberately has none — with auth disabled there is no user id, so every
 * request here is refused. A local console therefore needs a real session and a
 * real flag, which is the same thing production needs. An admin gate that turns
 * itself off on an environment variable is one environment variable away from
 * being no gate at all.
 */
export async function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const refuse = (reason: string): void => {
        console.warn(`[admin] refused ${req.method} ${req.originalUrl} — ${reason}`);

        res.status(404).json({ error: "Not found" });
    };

    if (!req.supabaseUserId) {
        refuse("no user on the request");
        return;
    }

    try {
        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("id, is_admin")
            .eq("user_id", req.supabaseUserId)
            .maybeSingle();

        if (error) {
            // A failed lookup is not a refusal: the caller may well be an admin
            // and there is nothing they can fix. Same split `requireSupabaseUser`
            // makes between a rejected token and an unreachable Supabase.
            console.error("[admin] profile lookup failed", error);

            res.status(503).json({ error: "Authorization unavailable" });
            return;
        }

        if (!data?.is_admin) {
            refuse(`user ${req.supabaseUserId} is not an admin`);
            return;
        }

        // Handed downstream so a handler that records who did something does not
        // resolve the profile a second time. Every write in this module that
        // stamps an actor reads it from here.
        req.adminProfileId = data.id;

        next();
    } catch (cause) {
        console.error("[admin] authorization failed", cause);

        res.status(503).json({ error: "Authorization unavailable" });
    }
}
