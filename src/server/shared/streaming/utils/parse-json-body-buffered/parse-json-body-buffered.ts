import { IncomingMessage } from "node:http";

/**
 * Parse JSON body from HTTP request using buffer concatenation.
 * Suitable for large payloads (e.g., base64-encoded images).
 */
export function parseJsonBodyBuffered(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                const body = Buffer.concat(chunks).toString("utf-8");
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}
