import { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod/v4";

import { buildCorsHeaders, handleCorsPrelight, type CorsConfig } from "../cors";
import { handleError } from "../error-handler";
import { parseJsonBody } from "../parse-json-body";
import { parseJsonBodyBuffered } from "../parse-json-body-buffered";
import { initSseStream, writeSseEvent, endSseStream } from "../streaming";

export type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "PATCH"
    | "OPTIONS";

export type HandlerResult =
    | { type: "json"; data: any }
    | { type: "stream"; stream: AsyncIterable<any> }
    | { type: "raw"; statusCode: number; data: any };

export interface StreamHandlerConfig<
    TRequestSchema extends z.ZodType,
    TResponseSchema extends z.ZodType | z.ZodType[],
> {
    /** Schema for validating request body */
    requestSchema: TRequestSchema;

    /** Schema(s) for response - single schema or array for streaming */
    responseSchema: TResponseSchema;

    /**
     * Handler function that processes the request.
     * Receives validated request body and HTTP request/response objects.
     * Returns result indicating how to send the response.
     */
    handler: (params: {
        body: z.infer<TRequestSchema>;
        req: IncomingMessage;
        res: ServerResponse;
    }) => Promise<HandlerResult>;

    /** Optional post-completion hook called after response is sent */
    onComplete?: (params: {
        body: z.infer<TRequestSchema>;
        result: any;
    }) => Promise<void>;

    /** Optional custom error handler */
    onError?: (
        error: Error,
        headersSent: boolean
    ) => {
        statusCode: number;
        message: string;
    };

    /** Allowed HTTP methods (default: ["POST"]) */
    allowedMethods?: HttpMethod[];

    /** CORS configuration (default: allow all) */
    cors?: CorsConfig;

    /** Use buffered parser for large payloads like images (default: false) */
    useBufferedParser?: boolean;
}

/**
 * Detect if the response schema indicates streaming mode.
 *
 * Auto-detection rules:
 * 1. If schema is an array → streaming mode
 * 2. If schema has discriminator 'type' field with literal value → streaming mode
 * 3. Otherwise → non-streaming JSON mode
 */
function isStreamingSchema(schema: z.ZodType | z.ZodType[]): boolean {
    // If schema is an array, it's streaming (JSONL with multiple types)
    if (Array.isArray(schema)) {
        return true;
    }

    // If schema is a Zod union or discriminated union, check for 'type' discriminator
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        if (shape.type && shape.type instanceof z.ZodLiteral) {
            return true;
        }
    }

    return false;
}

/**
 * Create a stream endpoint handler with automatic streaming detection and HTTP boilerplate handling.
 *
 * The factory handles:
 * - CORS preflight (OPTIONS)
 * - HTTP method validation
 * - Request body parsing and validation
 * - Streaming vs non-streaming response modes
 * - Error handling with streaming awareness
 * - Post-completion hooks
 *
 * @example
 * ```typescript
 * export const handleMyEndpoint = createStreamHandler({
 *   requestSchema: z.object({ name: z.string() }),
 *   responseSchema: z.object({ result: z.string() }),
 *   handler: async ({ body }) => ({
 *     type: "json",
 *     data: { result: `Hello ${body.name}` }
 *   })
 * });
 * ```
 */
export function createStreamHandler<
    TRequestSchema extends z.ZodType,
    TResponseSchema extends z.ZodType | z.ZodType[],
>(
    config: StreamHandlerConfig<TRequestSchema, TResponseSchema>
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    const allowedMethods = config.allowedMethods || ["POST"];
    const corsHeaders = buildCorsHeaders(config.cors);
    const isStreaming = isStreamingSchema(config.responseSchema);
    const parser = config.useBufferedParser
        ? parseJsonBodyBuffered
        : parseJsonBody;

    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        // Handle CORS preflight
        if (req.method === "OPTIONS") {
            handleCorsPrelight(res, corsHeaders);
            return;
        }

        // Validate HTTP method
        if (!allowedMethods.includes(req.method as HttpMethod)) {
            res.writeHead(405, {
                ...corsHeaders,
                "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        try {
            // Parse and validate request body
            const rawBody = await parser(req);
            const body = config.requestSchema.parse(rawBody);

            // Execute handler
            const result = await config.handler({ body, req, res });

            // Handle different result types
            if (result.type === "stream") {
                initSseStream(res, corsHeaders);

                let lastItem: any;
                for await (const item of result.stream) {
                    writeSseEvent(res, item);
                    lastItem = item;
                }

                endSseStream(res);

                // Call post-completion hook if provided
                if (config.onComplete) {
                    await config.onComplete({ body, result: lastItem });
                }
            } else if (result.type === "json") {
                res.writeHead(200, {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                });
                res.end(JSON.stringify(result.data));

                // Call post-completion hook if provided
                if (config.onComplete) {
                    await config.onComplete({ body, result: result.data });
                }
            } else if (result.type === "raw") {
                res.writeHead(result.statusCode, {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                });
                res.end(JSON.stringify(result.data));

                // Call post-completion hook if provided
                if (config.onComplete) {
                    await config.onComplete({ body, result: result.data });
                }
            }
        } catch (error) {
            handleError(error, res, { corsHeaders, isStreaming });
        }
    };
}
