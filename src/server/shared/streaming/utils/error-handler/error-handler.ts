import { ServerResponse } from "node:http";

import { z } from "zod/v4";

import { writeSseEvent } from "../streaming";

export interface ErrorHandlerConfig {
    corsHeaders: Record<string, string>;
    isStreaming: boolean;
}

/**
 * Handle errors in MCP endpoints with awareness of streaming state.
 *
 * For streaming responses:
 * - If headers already sent: write error as SSE event and end stream
 * - If headers not sent: send JSON error response
 *
 * For non-streaming responses:
 * - Always send JSON error response with appropriate status code
 *
 * @param error - The error that occurred
 * @param res - The HTTP response object
 * @param config - Configuration (CORS headers and streaming state)
 */
export function handleError(
    error: unknown,
    res: ServerResponse,
    config: ErrorHandlerConfig
): void {
    const message =
        error instanceof Error ? error.message : "Internal server error";

    const statusCode = error instanceof z.ZodError ? 400 : 500;

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
