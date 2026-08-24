import { z } from "zod/v4";

import { classifyError, type ClassifiedError } from "../classify-error";

/**
 * What a log line needs to name the failure and the feature it happened in.
 *
 * `route` is the only required field, and it is required for a reason: during
 * the 2026-08-21 quota outage the log group did contain lines from
 * `generateChatStream`, and they were nearly useless because nothing on them
 * said which endpoint had gone dark. A `code` without a `route` tells you the
 * product is broken but not what to test after you fix it.
 */
export interface RequestErrorContext {
    /**
     * Stable dotted name of the endpoint, e.g. `recipes.chat`. Written by hand
     * rather than derived from `req.url`, because a mounted Express router only
     * sees its sub-path — `/:recipeId/chat` and `/chat` are different features
     * that both arrive here looking like `/chat`.
     */
    route: string;

    /** HTTP method, when the caller has the request to hand. */
    method?: string;

    /**
     * Request path, query string already stripped. Callers pass the raw
     * `req.url` at their peril — see {@link stripQuery}.
     */
    path?: string;

    /** Whether the response had already committed to being a stream. */
    streaming?: boolean;

    /** HTTP status actually sent, when one was. */
    status?: number;

    /**
     * Where in the handler this happened — `pre_stream`, `mid_stream`,
     * `provider_event`. Worth having because the two differ in what the client
     * can still be told: before the stream opens a status code is available,
     * after it opens the only channel is a frame.
     */
    phase?: string;

    /**
     * Extra facts, merged into the line. Ids and enum-ish values only — never
     * request bodies, prompts or provider response objects. See the note on
     * {@link logRequestError} about what provider SDK errors carry.
     */
    detail?: Record<string, unknown>;
}

/** Drop a query string, which can carry ids and free text the log has no use for. */
export const stripQuery = (url: string | undefined): string | undefined =>
    url?.split("?")[0];

/**
 * Report a failed request to CloudWatch, and hand the classification back.
 *
 * This is the one place a server-side failure becomes visible, and it is
 * deliberately callable from outside `handleError`: three SSE endpoints
 * (`recipes.chat`, `recipes.compose`, `chat`) are hand-rolled Express handlers
 * that never touch `createStreamHandler`, so wiring only the factory would
 * have left the highest-touch conversational surfaces exactly as silent as
 * they were before.
 *
 * Three deliberate choices, unchanged from when this lived privately in
 * `error-handler.ts`:
 *
 *  - **Severity follows fault, not status.** A `client` fault is a WARN: a
 *    malformed body is a normal thing for a public API to receive and paging
 *    someone for it trains them to ignore the channel. Everything else is an
 *    ERROR, because it is ours.
 *  - **One JSON object per line**, so CloudWatch Logs Insights can filter on
 *    `code` and a metric filter can alarm on it. The existing `[tag] message`
 *    convention reads well and greps badly; keeping the tag as a prefix means
 *    both work.
 *  - **The message and stack, never the error object.** Provider SDK errors
 *    carry their full response headers, which for OpenAI includes a
 *    `set-cookie` with a Cloudflare bot token. `JSON.stringify` on the error
 *    itself puts all of it in the log group.
 *
 * Returns the {@link ClassifiedError} so a caller that also has to decide a
 * status or a frame does not classify twice.
 */
export function logRequestError(
    error: unknown,
    context: RequestErrorContext
): ClassifiedError {
    const classified = classifyError(error);

    const line = JSON.stringify({
        code: classified.code,
        fault: classified.fault,
        retryable: classified.retryable,
        route: context.route,
        phase: context.phase,
        status: context.status,
        method: context.method,
        path: context.path,
        streaming: context.streaming,
        message: error instanceof Error ? error.message : String(error),
        // A Zod error's `issues` say which field was wrong, which its
        // `message` already stringifies — the stack is just this file.
        stack:
            error instanceof Error && !(error instanceof z.ZodError)
                ? error.stack
                : undefined,
        ...context.detail,
    });

    if (classified.fault === "client") {
        console.warn(`[api] request failed ${line}`);
    } else {
        console.error(`[api] request failed ${line}`);
    }

    return classified;
}

/**
 * Report a request that did not throw and did not work either.
 *
 * The gap this closes is the one that prompted it: a recipe-chat turn can end
 * having emitted neither an answer nor a proposal — an unparseable sentinel, a
 * `MODIFY:` line with no instruction behind it, a provider that streamed zero
 * tokens — and every one of those paths returned quietly. The client draws its
 * dead-end-turn state, the user reports "something went wrong", and the log
 * group holds a clean 200 with nothing in it.
 *
 * WARN rather than ERROR: nothing crashed, and the honest severity of "the
 * model said something we could not use" is lower than a provider outage. It
 * shares the `[api]` prefix and the one-JSON-object-per-line shape so the same
 * Logs Insights query finds both.
 */
export function logRequestAnomaly(
    reason: string,
    context: Omit<RequestErrorContext, "status">
): void {
    console.warn(
        `[api] request anomaly ${JSON.stringify({
            reason,
            route: context.route,
            phase: context.phase,
            method: context.method,
            path: context.path,
            streaming: context.streaming,
            ...context.detail,
        })}`
    );
}
