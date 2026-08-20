import type { Request, Response } from "express";

import { resolveProfileId } from "../../recipes/services";

/**
 * The caller's profile id, or null having already answered the request.
 *
 * Every route in this module is per-user and useless without a profile, so the
 * same four lines would otherwise open all four handlers. Returning null
 * *after* responding lets a caller write `if (!profileId) return;`, which keeps
 * the "who is asking" hop from growing an error branch at each site.
 *
 * ## Why this is 401 and not 500
 *
 * `resolveProfileId` collapses two situations into null: no user id on the
 * request at all (`ALLOW_UNAUTHENTICATED=true`, which is the only way past
 * `requireSupabaseUser`), and a signed-in user whose profile row never got
 * written. The first is a local-development configuration and the second is a
 * signup that half-failed.
 *
 * They are reported as one thing because the client can do the same thing about
 * both — sign in again — and because the alternative leaks which of the two it
 * is to anyone who asks. It is logged distinctly, since the two need very
 * different fixes from this side.
 */
export async function requireProfileId(
    req: Request,
    res: Response
): Promise<string | null> {
    const profileId = await resolveProfileId(req.supabaseUserId);

    if (!profileId) {
        console.warn(
            req.supabaseUserId
                ? `[Prompts] No profile row for user ${req.supabaseUserId}`
                : "[Prompts] No user on the request — is ALLOW_UNAUTHENTICATED set?"
        );

        res.status(401).json({ error: "Unauthorized" });

        return null;
    }

    return profileId;
}
