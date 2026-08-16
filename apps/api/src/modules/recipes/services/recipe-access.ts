import type { IncomingMessage } from "node:http";

import type { Request } from "express";

import { resolveProfileId } from "./resolve-profile-id";

/**
 * May this caller read this recipe?
 *
 * RLS answers the same question for every read the CLIENT makes directly
 * (20260815000005), and `find_recipes` answers it in its own WHERE clause. This
 * is the third seat at that table: the API reads recipes through the
 * service-role client, which bypasses RLS by design — it has to, since it also
 * writes — so a route that takes a recipe id from the request and hands the row
 * back has to apply the rule itself. Nothing else will.
 *
 * The rule is the same one, and it is one sentence: an unowned recipe is the
 * shared catalogue and everyone may read it; an owned one belongs to exactly one
 * profile.
 *
 * ## Costs nothing on the path that matters
 *
 * The owner check short-circuits on `createdBy` being null, which is every
 * generated recipe and therefore every request today. The `profiles` lookup — a
 * single indexed round trip — is paid only when the recipe actually has an
 * owner, i.e. only by the person who imported it and by whoever is trying to
 * read it who should not be.
 *
 * ## Fails CLOSED
 *
 * A caller whose profile cannot be resolved — no request at all (an eval or a
 * background job), no token, no profile row, a failed lookup — reads as "not the
 * owner" rather than as "unrestricted". The
 * asymmetry is deliberate: refusing the owner costs them a retry, and the other
 * direction hands a private recipe to a stranger. Note this makes owned recipes
 * unreachable under `ALLOW_UNAUTHENTICATED=true`, which is correct — with the
 * gate off there is no subject to be the owner.
 */
export async function callerMayReadRecipe(
    createdBy: string | null | undefined,
    req: IncomingMessage | undefined
): Promise<boolean> {
    if (!createdBy) {
        return true;
    }

    const profileId = await resolveProfileId(
        req ? (req as Request).supabaseUserId : undefined
    );

    return profileId !== null && profileId === createdBy;
}
