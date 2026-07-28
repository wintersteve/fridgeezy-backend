import type { Request, Response } from "express";

export interface SseEvent {
    type: string;
    data?: any;
}

/**
 * Write a single named SSE event — `event: <type>\ndata: <json>\n\n` — the shape
 * the app's SSE client (create-sse-client) subscribes to by event name.
 */
export function writeSseEvent(res: Response, event: SseEvent): void {
    res.write(`event: ${event.type}\n`);
    if (event.data !== undefined) {
        res.write(`data: ${JSON.stringify(event.data)}\n`);
    }
    res.write("\n");
}

/** Initialise the SSE response stream headers. */
export function initSseStream(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
export async function parseJsonBody(req: Request): Promise<any> {
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
