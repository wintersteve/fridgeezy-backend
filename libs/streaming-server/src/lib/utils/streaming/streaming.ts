import { ServerResponse } from "node:http";

import { z } from "zod/v4";

import { SSE_HEADERS } from "../../constants";

/**
 * Initialize Server-Sent Events (SSE) stream.
 * Sets appropriate headers and flushes them immediately.
 */
export function initSseStream(
    res: ServerResponse,
    corsHeaders: Record<string, string>
): void {
    res.writeHead(200, { ...corsHeaders, ...SSE_HEADERS });
    res.flushHeaders();
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
                const parsed = JSON.parse(trimmed);

                // Try to match against one of the schemas
                let matched = false;
                for (let i = 0; i < schemas.length; i++) {
                    try {
                        const validated = schemas[i].parse(parsed);
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
                        "[processJsonlStream] Parsed JSON matched no schema:",
                        JSON.stringify(parsed).slice(0, 200)
                    );
                }
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
            const parsed = JSON.parse(remaining);

            let matched = false;
            for (let i = 0; i < schemas.length; i++) {
                try {
                    const validated = schemas[i].parse(parsed);
                    yield { parsed: validated, schemaIndex: i };
                    matched = true;
                    break;
                } catch {
                    continue;
                }
            }
            if (!matched) {
                console.warn(
                    "[processJsonlStream] Remaining buffer matched no schema:",
                    JSON.stringify(parsed).slice(0, 200)
                );
            }
        } catch {
            console.warn(
                "[processJsonlStream] Failed to parse remaining buffer:",
                remaining.slice(0, 200)
            );
        }
    }
}
