import { ServerResponse } from "node:http";

import { z } from "zod/v4";

import { logRequestError } from "../log-request-error";
import { writeSseEvent } from "../streaming";

export interface ErrorHandlerConfig {
    corsHeaders: Record<string, string>;
    isStreaming: boolean;
    /**
     * Request context for the log line.
     *
     * Optional so an existing caller keeps compiling, but every call from
     * `createStreamHandler` supplies it — without the path, a log line saying
     * `provider_quota_exhausted` cannot tell you *which* feature went dark.
     */
    method?: string;
    path?: string;
    /**
     * Stable dotted feature name. Defaults to the path when absent, which is
     * the best a generic factory can do; the hand-rolled handlers that call
     * `logRequestError` directly name themselves properly.
     */
    route?: string;
}

/**
 * Handle errors in a streaming-aware manner.
 *
 * For streaming responses:
 * - If headers already sent: send error as SSE event and end stream
 * - If headers not sent: send JSON error response
 *
 * For non-streaming responses:
 * - Always send JSON error response with appropriate status code
 *
 * Logging lives in `logRequestError`, which is shared rather than private to
 * this module: three SSE endpoints are hand-rolled Express handlers that never
 * reach this factory, and wiring only this one would have left them silent.
 *
 * The response is byte-identical to what this sent before logging was added.
 * Reshaping it — a machine-readable `code` on the wire, a status that
 * distinguishes "we are down" from "you sent nonsense" — is a contract change
 * the client has to be taught first, and is proposed in `ERROR_STRATEGY.md`
 * rather than done here.
 *
 * @param error - The error that occurred
 * @param res - The HTTP response object
 * @param config - Configuration (CORS headers, streaming state, request context)
 */
export function handleError(
    error: unknown,
    res: ServerResponse,
    config: ErrorHandlerConfig
): void {
    const message =
        error instanceof Error ? error.message : "Internal server error";

    const statusCode = error instanceof z.ZodError ? 400 : 500;

    logRequestError(error, {
        route: config.route ?? config.path ?? "unknown",
        method: config.method,
        path: config.path,
        streaming: config.isStreaming,
        status: statusCode,
        phase: res.headersSent ? "mid_stream" : "pre_stream",
    });

    if (config.isStreaming && res.headersSent) {
        // Already streaming - send error as SSE event
        writeSseEvent(res, { error: message });
        res.end();
    } else {
        // Not streaming or headers not sent - send JSON error
        res.writeHead(statusCode, {
            ...config.corsHeaders,
            "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: message }));
    }
}
