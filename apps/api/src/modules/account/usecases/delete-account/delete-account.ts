import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

export interface DeleteAccountResponse {
    deleted: true;
}

/**
 * `POST /rest/account/delete` — erase the caller's account and everything
 * hanging off it.
 *
 * ## Why this route exists at all
 *
 * The app has shown a "Delete Account" row with a confirmation alert since the
 * settings screen was written, promising to "permanently delete your account
 * and all associated data" — and its handler was an empty function. Nothing
 * happened, here or anywhere else. That is a promise the product was not
 * keeping and an App Store 5.1.1(v) exposure on its own, since an app that
 * offers account creation has to offer deletion in-app.
 *
 * ## One call, because the schema already says what belongs to whom
 *
 * `auth.admin.deleteUser` and nothing else. Everything profile-scoped is
 * `on delete cascade` from `profiles`, which is itself cascade from
 * `auth.users` — seventeen tables, verified against the database rather than
 * assumed. Writing the deletes by hand would be seventeen statements that have
 * to be kept in step with every future table, and the constraint is the thing
 * that cannot drift.
 *
 * **Two of those cascades look alarming and are correct.** `recipes.created_by`
 * and `menus.owner_profile_id` both cascade, but both are NULL for shared
 * content by design: a non-null `created_by` is an IMPORTED recipe, private to
 * the importer, and an owned menu is a private composition (`20260916000002`).
 * The catalogue a departing account generated stays — it was never theirs — and
 * so do the menus other people have saved.
 *
 * ## Service role, and therefore no RLS
 *
 * `supabaseAdmin` bypasses row-level security, so the ONE thing standing
 * between a caller and somebody else's account is that the id comes from
 * `requireSupabaseUser` (`req.supabaseUserId`) and never from the request body.
 * There is no `userId` parameter here on purpose — a route that took one would
 * be an account-deletion oracle for anyone holding any valid token.
 *
 * ## It is irreversible and it is not confirmed here
 *
 * The confirmation is the app's alert. A `confirm=true` in the wire format
 * would only mean the client always sends it — the same argument
 * `forgetPrompts` records for its own unfiltered delete.
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
    const userId = req.supabaseUserId;

    if (!userId) {
        // The only way past `requireSupabaseUser` without one is
        // `ALLOW_UNAUTHENTICATED=true` locally, and "delete the account" has no
        // meaning for nobody. Same 401 `requireProfileId` answers with, for the
        // same reason.
        console.warn("[Account] No user on the request — is ALLOW_UNAUTHENTICATED set?");

        res.status(401).json({ error: "Unauthorized" });

        return;
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
        // Logged with the id because this is the one failure the user cannot
        // work around themselves, and support will be asked about it.
        console.error(`[Account] Failed to delete user ${userId}:`, error);

        res.status(500).json({ error: "Failed to delete account" });

        return;
    }

    const body: DeleteAccountResponse = { deleted: true };

    res.json(body);
}
