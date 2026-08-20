import {
    ListPromptsRequestSchema,
    type ListPromptsResponseDto,
} from "@fridgeezy/schemas";
import { listPrompts } from "@fridgeezy/supabase";
import type { Request, Response } from "express";
import { z } from "zod/v4";

import { requireProfileId } from "../../services";

/**
 * `GET /rest/prompts` — the caller's own prompt history, newest first.
 *
 * A plain Express handler rather than `createStreamHandler`, because that
 * factory reads and validates a JSON *body* and this is a GET whose parameters
 * are in the query string. `share-recipe.ts` and `recipe-chat.ts` are the
 * existing precedent for a hand-written handler in this codebase; CORS is
 * applied globally in `express-app.ts`, so nothing is lost by not going through
 * the factory here.
 *
 * ## Reading is also possible without this endpoint
 *
 * `users_read_own_prompts` lets the client select its own rows straight through
 * PostgREST, the way it already reads `profile_taste_signals`. That path is
 * cheaper — no Lambda cold start — and is the one to prefer for a screen that
 * just lists history. This endpoint exists for callers that hold an API token
 * and no Supabase session, and so that the read and the write have the same
 * shape and the same filters.
 */
export async function listPromptHistory(
    req: Request,
    res: Response
): Promise<void> {
    const parsed = ListPromptsRequestSchema.safeParse(req.query);

    if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return;
    }

    const profileId = await requireProfileId(req, res);

    if (!profileId) {
        return;
    }

    const { limit, ...filters } = parsed.data;

    try {
        // One more than asked for, so "is there another page" is answered by
        // the read itself. A short page cannot answer it — a full final page
        // and a full non-final one are indistinguishable — and the alternative
        // is a second count query on every request.
        const rows = await listPrompts(profileId, { ...filters, limit: limit + 1 });

        const entries = rows.slice(0, limit);
        const hasMore = rows.length > limit;

        const body: ListPromptsResponseDto = {
            entries,
            nextCursor: hasMore ? (entries.at(-1)?.createdAt ?? null) : null,
        };

        res.json(body);
    } catch (error) {
        console.error("[Prompts] Failed to list history:", error);
        res.status(500).json({ error: "Failed to read prompt history" });
    }
}
