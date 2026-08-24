import type { Request, Response } from "express";

export interface SseEvent {
    type: string;
    /**
     * Serialised with `JSON.stringify`, so `unknown` is the honest type: this
     * function does not read the payload, it only encodes it. Each caller knows
     * its own frame shape, and the client parses by event name.
     */
    data?: unknown;
}

/**
 * Write a single named SSE event — `event: <type>\ndata: <json>\n\n` — the shape
 * the app's SSE client (create-sse-client) subscribes to by event name.
 *
 * ## A data line is always written, even when the caller passes no payload
 *
 * This is not defensive tidiness. The SSE specification says an event is
 * dispatched only if the data buffer is non-empty — "if the data buffer is an
 * empty string, set the data buffer and the event type buffer to the empty
 * string and return" — so `event: end\n\n` with no data line is not a frame
 * carrying nothing. It is **no frame at all**, discarded by the parser before
 * any listener is consulted, and every conforming client behaves this way.
 *
 * `endSseStream` emitted exactly that shape, which meant the terminal `end`
 * event had never once been delivered to the app on any endpoint that uses
 * this writer. Nothing broke, because the client's `isDone` also matches
 * `done` — so the dead frame sat in both codebases looking load-bearing while
 * doing nothing, which is the part worth preventing: the next caller to omit
 * `data` would have inherited the same silence.
 *
 * `{}` rather than an empty string, so the client's `JSON.parse` on the data
 * line still yields an object and the frame flows through the ordinary
 * `{...parsed, type}` path.
 */
export function writeSseEvent(res: Response, event: SseEvent): void {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data ?? {})}\n`);
    res.write("\n");
}

/**
 * Write an SSE comment line — ignored by every parser, dispatched to no
 * listener, and the only way to put bytes on the wire without inventing a frame
 * the client has to know about.
 *
 * Its job is to force the response out of Express and through Lambda's response
 * stream, which is what actually opens the connection from the client's point of
 * view. See `initSseStream`.
 */
export function writeSseComment(res: Response, note: string): void {
    res.write(`: ${note}\n\n`);
}

/**
 * Initialise the SSE response stream and **put it on the wire immediately**.
 *
 * ## Setting headers is not sending them
 *
 * `setHeader` only stages them. Express flushes on the first `res.write`, and on
 * these routes the first write is whatever the first model call produces — so
 * the client's EventSource did not fire `open` until a model had already
 * answered, one to three seconds in. Everything keyed off that open was
 * therefore late by the length of the slowest thing in the request:
 *
 * - `useSSEStream` starts its `DEFAULT_STALL_TIMEOUT` from the connection, so
 *   the stall budget was silently being spent before the stream existed.
 * - The connectivity machine's first-hand backend evidence arrives with the
 *   open; a cold Lambda looked indistinguishable from an unreachable one.
 * - There was no moment at which the UI could truthfully say "connected", which
 *   is the first thing a slow turn needs to be able to say.
 *
 * `flushHeaders()` sends them now, and the comment line that follows pushes a
 * body byte through Lambda's RESPONSE_STREAM framing so nothing downstream is
 * holding an empty buffer. Both are needed: headers alone can sit in the
 * proxy's buffer waiting for a body.
 */
export function initSseStream(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Nginx and friends buffer `text/event-stream` by default, which defeats
    // every flush below. Harmless where nothing reads it.
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    res.flushHeaders();
    writeSseComment(res, "open");
}

/** End the SSE stream with a terminal `end` event. */
export function endSseStream(res: Response): void {
    writeSseEvent(res, { type: "end" });
    res.end();
}

/**
 * Read and JSON-parse a raw request body. These streaming routes deliberately
 * skip the JSON body middleware, so we drain the stream ourselves.
 */
export async function parseJsonBody(req: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}
