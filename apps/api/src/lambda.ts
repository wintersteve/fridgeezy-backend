// No `dotenv/config` here on purpose — configuration arrives as Lambda
// environment variables, and there is no .env file in the deployment package.
import "reflect-metadata";

import http from "node:http";
import type { AddressInfo } from "node:net";
import { pipeline } from "node:stream/promises";

import { pendingBackgroundTaskCount, settleBackgroundTasks } from "./background-tasks";
import { createApp } from "./create-app";

/**
 * Connection-scoped headers, which must not be forwarded across a proxy hop
 * (RFC 9110 §7.6.1).
 */
const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

/** Left on the clock so the drain cannot itself cause the invocation to time out. */
const DRAIN_SAFETY_MARGIN_MS = 2_000;

let listening: Promise<number> | undefined;

/**
 * Starts the Express app on a loopback port, once per execution environment.
 *
 * Proxying over a real socket rather than synthesising an `IncomingMessage` is
 * what keeps the raw-body path intact: `express-app.ts` deliberately omits
 * `express.json()` because the handlers read the request stream themselves.
 * A genuine HTTP request satisfies that for free, where a hand-rolled mock would
 * have to reproduce stream semantics exactly.
 */
function listen(): Promise<number> {
    if (!listening) {
        const started = new Promise<number>((resolve, reject) => {
            const server = http.createServer(createApp());

            // SSE writes are small and frequent; Nagle would add up to 40ms of
            // latency to each one.
            server.on("connection", (socket) => socket.setNoDelay(true));
            server.once("error", reject);

            server.listen(0, "127.0.0.1", () => {
                resolve((server.address() as AddressInfo).port);
            });
        });

        // Do not cache a failed bind — the next invocation should retry.
        started.catch(() => {
            listening = undefined;
        });

        listening = started;
    }

    return listening;
}

function buildRequestHeaders(event: LambdaFunctionUrlEvent): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(event.headers ?? {})) {
        if (value === undefined) {
            continue;
        }

        const header = name.toLowerCase();

        // Recomputed from the decoded body, which may differ in length from the
        // base64 payload the runtime delivered.
        if (HOP_BY_HOP_HEADERS.has(header) || header === "content-length") {
            continue;
        }

        headers[header] = value;
    }

    if (event.cookies?.length) {
        headers.cookie = event.cookies.join("; ");
    }

    return headers;
}

function decodeBody(event: LambdaFunctionUrlEvent): Buffer | undefined {
    if (event.body === undefined || event.body === null) {
        return undefined;
    }

    return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

function sendUpstream(
    event: LambdaFunctionUrlEvent,
    port: number
): Promise<http.IncomingMessage> {
    const body = decodeBody(event);
    const headers = buildRequestHeaders(event);
    const query = event.rawQueryString ? `?${event.rawQueryString}` : "";

    if (body) {
        headers["content-length"] = body.byteLength;
    }

    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                host: "127.0.0.1",
                port,
                method: event.requestContext.http.method,
                path: `${event.rawPath || "/"}${query}`,
                headers,
            },
            resolve
        );

        request.on("socket", (socket) => socket.setNoDelay(true));
        request.once("error", reject);

        if (body) {
            request.write(body);
        }

        request.end();
    });
}

function buildResponseMetadata(upstream: http.IncomingMessage): LambdaHttpResponseMetadata {
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(upstream.headers)) {
        if (value === undefined) {
            continue;
        }

        const header = name.toLowerCase();

        if (HOP_BY_HOP_HEADERS.has(header)) {
            continue;
        }

        // Carried separately in `cookies`; joining them with a comma would
        // corrupt any cookie containing a comma in its Expires attribute.
        if (header === "set-cookie") {
            continue;
        }

        // The body is re-framed as it is streamed back, so an inherited length
        // can disagree with what the client actually receives.
        if (header === "content-length") {
            continue;
        }

        headers[header] = Array.isArray(value) ? value.join(", ") : value;
    }

    const cookies = upstream.headers["set-cookie"];

    return {
        statusCode: upstream.statusCode ?? 502,
        headers,
        ...(cookies?.length ? { cookies } : {}),
    };
}

/**
 * Lets the fire-and-forget image uploads finish.
 *
 * Runs after the response stream has closed, so it costs the client nothing —
 * only billed duration, and only when an upload is still in flight.
 */
async function drainBackgroundTasks(context: LambdaContext): Promise<void> {
    if (pendingBackgroundTaskCount() === 0) {
        return;
    }

    const budget = context.getRemainingTimeInMillis() - DRAIN_SAFETY_MARGIN_MS;

    if (budget <= 0 || !(await settleBackgroundTasks(budget))) {
        console.warn(
            `Background tasks still pending after the drain budget (${pendingBackgroundTaskCount()} remaining); ` +
                `recipe image generation may be incomplete for request ${context.awsRequestId}.`
        );
    }
}

/**
 * Every endpoint in this app streams (SSE), so the function is invoked in
 * RESPONSE_STREAM mode behind a Function URL. See `infra/README.md`.
 */
export const handler = awslambda.streamifyResponse(
    async (event, responseStream, context) => {
        // The loopback server stays bound for the life of the execution
        // environment, so the event loop is never empty. Without this, Lambda
        // would wait for it to drain and every invocation would hit the timeout.
        context.callbackWaitsForEmptyEventLoop = false;

        let responded = false;

        try {
            const port = await listen();
            const upstream = await sendUpstream(event, port);

            const target = awslambda.HttpResponseStream.from(
                responseStream,
                buildResponseMetadata(upstream)
            );

            responded = true;

            await pipeline(upstream, target);
        } catch (error) {
            console.error("Failed to proxy request to the Express app:", error);

            if (responded) {
                // Headers are already on the wire; the only honest signal left is
                // to break the stream so the client does not treat a truncated
                // body as complete.
                responseStream.destroy(error as Error);
            } else {
                const target = awslambda.HttpResponseStream.from(responseStream, {
                    statusCode: 502,
                    headers: { "content-type": "application/json" },
                });

                target.end(JSON.stringify({ error: "Bad Gateway" }));
            }
        } finally {
            await drainBackgroundTasks(context);
        }
    }
);
