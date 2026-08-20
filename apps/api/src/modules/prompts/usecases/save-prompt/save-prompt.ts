import {
    RecordPromptRequestSchema,
    type RecordPromptResponseDto,
} from "@fridgeezy/schemas";
import { persistPrompt } from "@fridgeezy/supabase";
import type { Request, Response } from "express";
import { z } from "zod/v4";

// The chat module's copy rather than the one inside `@fridgeezy/streaming-server`,
// which is internal to `createStreamHandler` and not exported from that package.
// Same reason every route here is hand-written: `express-app.ts` installs no
// JSON body middleware, so a handler outside the factory drains the stream
// itself.
import { parseJsonBody } from "../../../chat/services";
import { callerMayReadRecipe, fetchRecipeSummary } from "../../../recipes/services";
import { requireProfileId } from "../../services";

/**
 * `POST /rest/prompts` — record one prompt the API did not otherwise see.
 *
 * **This is not the main write path.** `POST /chat`,
 * `POST /recipes/:id/chat` and `POST /recipes/modify` record their own turn as
 * it passes, server-side, because they are holding the text anyway. This
 * endpoint is for prompts that never reach one of those — a turn abandoned
 * before it was sent, or a future surface talking to something other than this
 * API — and posting a turn one of them already carried writes the row twice.
 *
 * Awaited rather than fire-and-forget, unlike the auto-capture: a caller who
 * asked to record something is owed the row back, including the id that
 * `DELETE /rest/prompts/:id` takes.
 */
export async function savePrompt(req: Request, res: Response): Promise<void> {
    let raw: unknown;

    try {
        raw = await parseJsonBody(req);
    } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
    }

    const parsed = RecordPromptRequestSchema.safeParse(raw);

    if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return;
    }

    const profileId = await requireProfileId(req, res);

    if (!profileId) {
        return;
    }

    const { surface, prompt, recipeId, conversationId } = parsed.data;

    // A recipe id arriving in a request body is a caller-supplied id, so the
    // rule the rest of the API applies to those applies here: an owned recipe
    // (an import) is readable only by its owner, and this write goes through the
    // service-role client, which sees past the RLS enforcing that. Without the
    // check, anyone could attach history to a stranger's private import and read
    // its name back out of `recipeName` on the next list call.
    //
    // Folded into the same not-found answer the other routes use, so refusal and
    // absence stay indistinguishable.
    if (recipeId) {
        const summary = await fetchRecipeSummary(recipeId);

        if (!summary || !(await callerMayReadRecipe(summary.createdBy, req))) {
            res.status(404).json({ error: `Recipe not found: ${recipeId}` });
            return;
        }
    }

    try {
        const entry = await persistPrompt(profileId, {
            surface,
            prompt,
            recipeId,
            conversationId,
        });

        // The RPC returns null only for a prompt that was blank after trimming,
        // which the schema's `.trim().min(1)` has already refused. Reaching here
        // means the two disagree, which is worth a 500 rather than a null body
        // the client would have to defend against.
        if (!entry) {
            console.error("[Prompts] record_prompt returned no row for a validated prompt");
            res.status(500).json({ error: "Failed to record prompt" });
            return;
        }

        const body: RecordPromptResponseDto = { entry };

        res.status(201).json(body);
    } catch (error) {
        console.error("[Prompts] Failed to record prompt:", error);
        res.status(500).json({ error: "Failed to record prompt" });
    }
}
