import {
    DeletePromptsRequestSchema,
    type DeletePromptsResponseDto,
} from "@fridgeezy/schemas";
import { deletePromptById, deletePrompts } from "@fridgeezy/supabase";
import type { Request, Response } from "express";
import { z } from "zod/v4";

import { requireProfileId } from "../../services";

/**
 * `DELETE /rest/prompts` — forget a slice of history.
 *
 * Filters come from the query string (`?surface=`, `?recipeId=`,
 * `?conversationId=`), not from a body: a DELETE body is legal but widely
 * dropped by proxies and ignored by several HTTP clients, and a filter that
 * silently vanishes on this route turns "forget this thread" into "forget
 * everything".
 *
 * **No filters means all of this caller's history**, which is the whole point
 * of the route rather than an oversight. The confirmation belongs in the UI;
 * putting a required `confirm=true` in the wire format would only mean the
 * client sends it unconditionally.
 */
export async function forgetPrompts(req: Request, res: Response): Promise<void> {
    const parsed = DeletePromptsRequestSchema.safeParse(req.query);

    if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return;
    }

    const profileId = await requireProfileId(req, res);

    if (!profileId) {
        return;
    }

    try {
        const deleted = await deletePrompts(profileId, parsed.data);
        const body: DeletePromptsResponseDto = { deleted };

        res.json(body);
    } catch (error) {
        console.error("[Prompts] Failed to delete history:", error);
        res.status(500).json({ error: "Failed to delete prompt history" });
    }
}

/**
 * `DELETE /rest/prompts/:id` — forget one entry.
 *
 * 404 both when the id does not exist and when it belongs to somebody else. The
 * repository scopes the delete to the caller's profile, so the second case
 * cannot delete anything; reporting them alike keeps the route from being a way
 * to test whether a given prompt id exists.
 */
export async function forgetPrompt(req: Request, res: Response): Promise<void> {
    const id = z.uuid().safeParse(req.params.id);

    if (!id.success) {
        res.status(400).json({ error: "Invalid prompt id" });
        return;
    }

    const profileId = await requireProfileId(req, res);

    if (!profileId) {
        return;
    }

    try {
        const deleted = await deletePromptById(profileId, id.data);

        if (!deleted) {
            res.status(404).json({ error: "Prompt not found" });
            return;
        }

        const body: DeletePromptsResponseDto = { deleted: 1 };

        res.json(body);
    } catch (error) {
        console.error("[Prompts] Failed to delete prompt:", error);
        res.status(500).json({ error: "Failed to delete prompt" });
    }
}
