import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * The auth user id -> profile id hop.
 *
 * `requireSupabaseUser` resolves the caller to an `auth.users` id and hangs it
 * on the request. Every per-user table in this schema keys on `profiles.id`
 * instead, one link further down the signup chain
 * (`auth.users -> profiles -> profile_settings`, see `20260801000009`), so
 * anything that writes on a user's behalf has to make this hop first.
 *
 * Reads through the service-role client, which sees past RLS. That is correct
 * here and worth being explicit about: the caller has already been
 * authenticated by the middleware, this is looking up THEIR row by the id that
 * authentication produced, and the anon client could not do it without the
 * user's own JWT — which the API does not hold beyond the verification call.
 *
 * Returns null when there is no profile, which happens in exactly two ways:
 * `ALLOW_UNAUTHENTICATED=true` (so there is no user id to look up at all), or a
 * user whose profile insert never ran. Both are the caller's problem to report,
 * and both must be reported rather than defaulted — a write that falls back to
 * "no owner" is a private recipe published to the whole catalogue.
 */
export async function resolveProfileId(
    userId: string | undefined
): Promise<string | null> {
    if (!userId) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        console.error("[Profiles] Failed to resolve profile:", error.message);
        return null;
    }

    return data?.id ?? null;
}
