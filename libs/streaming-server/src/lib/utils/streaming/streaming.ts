import { ServerResponse } from "node:http";

import { z } from "zod/v4";

import { SSE_HEADERS } from "../../constants";

/**
 * Initialize Server-Sent Events (SSE) stream.
 *
 * Headers are flushed AND a comment line is written, because the two do
 * different jobs. `flushHeaders` hands the head to Node; the comment puts a
 * body byte on the wire, which is what actually travels through Lambda's
 * RESPONSE_STREAM framing and fires the client's `open`. Headers alone can sit
 * in a buffer waiting for a body, and on these routes the next body byte is
 * whatever the first model call produces — seconds later.
 *
 * A comment (`: ...`) is deliberately not a frame: every conforming parser
 * discards it without dispatching to a listener, so no client has to learn
 * about it.
 */
export function initSseStream(
    res: ServerResponse,
    corsHeaders: Record<string, string>
): void {
    res.writeHead(200, { ...corsHeaders, ...SSE_HEADERS });
    res.flushHeaders();
    res.write(": open\n\n");
}

/**
 * Write a single SSE event to the response stream.
 * Formats data in SSE format: `data: <json>\n\n`
 */
export function writeSseEvent(res: ServerResponse, data: any): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * End SSE stream with standard [DONE] message.
 */
export function endSseStream(res: ServerResponse): void {
    res.write("data: [DONE]\n\n");
    res.end();
}

/**
 * Process a JSONL (JSON Lines) stream from OpenAI, with buffering and schema validation.
 *
 * This handles the complex pattern of:
 * 1. Accumulating content into a buffer
 * 2. Splitting on newlines, keeping incomplete lines in buffer
 * 3. Parsing each complete line as JSON
 * 4. Validating against one of the provided schemas
 * 5. Yielding validated results with schema index
 * 6. Processing remaining buffer content at the end
 *
 * @param stream - OpenAI completion stream
 * @param schemas - Array of Zod schemas to validate against
 * @yields Objects with `parsed` (validated data) and `schemaIndex` (which schema matched)
 */
/**
 * Validate one already-parsed JSON value against the schemas and yield matches.
 *
 * The model is asked for JSONL (one object per line) but occasionally wraps its
 * output in a JSON array — and is explicitly instructed to emit an empty array
 * (`[]`) to signal "no authentic dishes". So accept both shapes: flatten an
 * array and validate each element, which lets `[]` yield nothing quietly and a
 * `[{...},{...}]` payload be parsed instead of dropped as "matched no schema".
 */
function* validateParsed<T extends z.ZodType[]>(
    parsed: unknown,
    schemas: T,
    context: string
): Generator<{ parsed: any; schemaIndex: number }> {
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
        let matched = false;
        for (let i = 0; i < schemas.length; i++) {
            try {
                const validated = schemas[i].parse(item);
                yield { parsed: validated, schemaIndex: i };
                matched = true;
                break; // Found matching schema, stop trying
            } catch {
                // Try next schema
                continue;
            }
        }
        if (!matched) {
            console.warn(
                `[processJsonlStream] ${context} matched no schema:`,
                JSON.stringify(item).slice(0, 200)
            );
        }
    }
}

export async function* processJsonlStream<T extends z.ZodType[]>(
    stream: AsyncIterable<{
        choices: Array<{ delta?: { content?: string | null } }>;
    }>,
    schemas: T
): AsyncGenerator<{ parsed: any; schemaIndex: number }> {
    let buffer = "";

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (!content) continue;

        buffer += content;

        // Split on newlines, keep incomplete line in buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Skip markdown fence lines LLMs occasionally emit
            if (trimmed.startsWith("```")) continue;

            try {
                yield* validateParsed(
                    JSON.parse(trimmed),
                    schemas,
                    "Parsed JSON"
                );
            } catch {
                console.warn(
                    "[processJsonlStream] Failed to parse JSON line:",
                    trimmed.slice(0, 200)
                );
            }
        }
    }

    // Process remaining buffer content
    const remaining = buffer.trim();
    if (remaining && !remaining.startsWith("```")) {
        try {
            yield* validateParsed(
                JSON.parse(remaining),
                schemas,
                "Remaining buffer"
            );
        } catch {
            console.warn(
                "[processJsonlStream] Failed to parse remaining buffer:",
                remaining.slice(0, 200)
            );
        }
    }
}
