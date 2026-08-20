import type { IncomingMessage } from "node:http";

import { persistPrompt, type PromptSurface } from "@fridgeezy/supabase";
import type { Request } from "express";

import { trackBackgroundTask } from "../../../background-tasks";
import { resolveProfileId } from "../../recipes/services";

export interface RecordPromptOptions {
    /** Required for `recipe_chat` and `recipe_modify`; omitted for `chat`. */
    recipeId?: string | null;
    /** Groups the turns of one conversation. Client-supplied and opaque. */
    conversationId?: string | null;
}

/**
 * Write one prompt to the caller's history.
 *
 * **Returns void and never throws, by design** — the same contract
 * `recordTasteSignal` has, and for the same reason. Every caller is a stream
 * handler in the middle of a paid model call; there is no outcome here worth
 * failing a recipe over, and no branch a caller could usefully take. The
 * repository throws honestly and this is the layer that decides to swallow it.
 *
 * Runs as a tracked background task rather than being awaited, so the profile
 * lookup and the insert never sit between the user and their first streamed
 * token. Tracked rather than merely floated because on Lambda an unawaited
 * promise is frozen when the handler returns — `lambda.ts` drains the registry
 * after the response closes.
 *
 * ## Why the capture is here and not in the client
 *
 * The three routes that carry user prose are already holding it on its way to a
 * model, so recording it costs one insert on a path that is about to spend
 * seconds and cents on inference. Pushing the write to the client instead would
 * make history a thing the client can forget — and it already does forget it:
 * the recipe-scoped Ask sheet writes nothing to `CHAT_HISTORY_STORE`, which is
 * why those prompts have never been recoverable anywhere.
 *
 * The deliberate consequence: `POST /rest/prompts` exists for prompts these
 * routes never see, and a client that also posts a turn one of them carried
 * writes the row twice. See `RecordPromptRequestSchema`.
 */
export function recordPrompt(
    req: IncomingMessage | undefined,
    surface: PromptSurface,
    prompt: string,
    { recipeId, conversationId }: RecordPromptOptions = {}
): void {
    // Cheap guard so a whitespace turn does not buy a profile lookup. The RPC
    // trims and refuses one too — this just declines to go and ask.
    if (!prompt.trim()) {
        return;
    }

    void trackBackgroundTask(
        (async () => {
            const profileId = await resolveProfileId(
                req ? (req as Request).supabaseUserId : undefined
            );

            // No profile is the normal case under `ALLOW_UNAUTHENTICATED`, and
            // an eval or a background job has no request at all. Nothing to
            // attribute the prompt to, so there is nothing to record.
            if (!profileId) {
                return;
            }

            await persistPrompt(profileId, {
                surface,
                prompt,
                recipeId,
                conversationId,
            });
        })()
    ).catch((error: unknown) => {
        console.error(
            "[Prompts] Failed to record prompt:",
            error instanceof Error ? error.message : String(error)
        );
    });
}
