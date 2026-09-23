import { SetHiddenSchema } from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { parseBody } from "../../services";

/**
 * `POST /rest/admin/recipes/:id/hidden` — pull a dish, or put it back.
 *
 * ## One route for both directions
 *
 * `{ hidden: true | false }` rather than a hide route and an unhide route. The
 * console's control is a toggle, and two paths would be two places that have to
 * stay in step about what hiding means.
 *
 * ## What actually happens, and it is nothing dramatic
 *
 * One column. `recipe_is_visible(created_by, hidden_at)` then does the work in
 * all five policies, and the four SECURITY DEFINER readers apply the same
 * predicate themselves. Nothing is deleted, nothing cascades, and putting the
 * dish back is this same route with `false`.
 *
 * **It is NOT a delete and must not become one.** A reader's favourite still
 * points at the row; the row is what makes un-hiding whole rather than
 * approximate.
 *
 * ## The actor is taken from the gate
 *
 * `hidden_by` is `req.adminProfileId`, resolved by `requireAdmin` from the
 * verified token. There is no actor field in the body on purpose — a route
 * that took one would let an admin file their decisions under somebody else.
 *
 * ## `hidden_at` is only stamped on a transition
 *
 * Hiding an already-hidden dish leaves the original timestamp and reason alone
 * unless a new reason is sent, so "when was this pulled" survives a double
 * click and an idempotent retry.
 */
export async function setRecipeHidden(req: Request, res: Response): Promise<void> {
    const body = parseBody(SetHiddenSchema, req, res);

    if (!body) return;

    const { data: current, error: lookupError } = await supabaseAdmin
        .from("recipes")
        .select("id, name, hidden_at")
        .eq("id", req.params.id)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] setRecipeHidden lookup failed", lookupError);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!current) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const alreadyHidden = current.hidden_at !== null;

    const patch = body.hidden
        ? {
              hidden_at: alreadyHidden ? current.hidden_at : new Date().toISOString(),
              hidden_by: req.adminProfileId ?? null,
              // Only overwritten when one was sent, so a re-hide does not
              // silently erase the reason the first one recorded.
              ...(body.reason !== undefined ? { hidden_reason: body.reason } : {}),
          }
        : { hidden_at: null, hidden_by: null, hidden_reason: null };

    const { error } = await supabaseAdmin
        .from("recipes")
        .update(patch)
        .eq("id", req.params.id);

    if (error) {
        console.error("[admin] setRecipeHidden failed", error);
        res.status(500).json({ error: "Could not change visibility" });
        return;
    }

    console.log(
        `[admin] ${req.adminProfileId} ${body.hidden ? "hid" : "restored"} recipe ${current.id} (${current.name})`
    );

    res.json({ hidden: body.hidden });
}

/** The same, for a suggestion. Same shape, different table, same reasoning. */
export async function setSuggestionHidden(
    req: Request,
    res: Response
): Promise<void> {
    const body = parseBody(SetHiddenSchema, req, res);

    if (!body) return;

    const { data: current, error: lookupError } = await supabaseAdmin
        .from("recipe_suggestions")
        .select("id, name, hidden_at")
        .eq("id", req.params.id)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] setSuggestionHidden lookup failed", lookupError);
        res.status(500).json({ error: "Could not read suggestion" });
        return;
    }

    if (!current) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const patch = body.hidden
        ? {
              hidden_at: current.hidden_at ?? new Date().toISOString(),
              hidden_by: req.adminProfileId ?? null,
              ...(body.reason !== undefined ? { hidden_reason: body.reason } : {}),
          }
        : { hidden_at: null, hidden_by: null, hidden_reason: null };

    const { error } = await supabaseAdmin
        .from("recipe_suggestions")
        .update(patch)
        .eq("id", req.params.id);

    if (error) {
        console.error("[admin] setSuggestionHidden failed", error);
        res.status(500).json({ error: "Could not change visibility" });
        return;
    }

    console.log(
        `[admin] ${req.adminProfileId} ${body.hidden ? "hid" : "restored"} suggestion ${current.id} (${current.name})`
    );

    res.json({ hidden: body.hidden });
}
