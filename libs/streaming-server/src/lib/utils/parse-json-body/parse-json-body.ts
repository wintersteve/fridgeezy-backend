import { IncomingMessage } from "node:http";

/**
 * Parse JSON body from HTTP request using string concatenation.
 * Suitable for most requests with text-based JSON payloads.
 */
export function parseJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
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
