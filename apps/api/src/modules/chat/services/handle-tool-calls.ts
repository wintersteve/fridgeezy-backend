import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";

/**
 * What a tool handler resolves to. Handlers answer in the content-block shape
 * (`{ content: [{ type: "text", text }] }`); anything else is stringified whole
 * by the caller, so the fields are optional rather than assumed.
 */
export interface ToolResult {
    content?: Array<{ type: string; text?: string }>;
}

/**
 * Drop the arguments a tool's schema does not accept, keeping the rest.
 *
 * ## The defect this closes
 *
 * A tool declares its inputs as a zod object — `component` is
 * `z.enum(COMPONENT_TAGS)`, `course` a three-value enum — and **nothing ever
 * checked the model's arguments against it.** The registry is heterogeneous, so
 * `handler(input: unknown)` was taken literally: `JSON.parse`, spread through
 * three argument layers, handed over.
 *
 * Measured 2026-09-13: "what goes well with Korean chicken?" routed to
 * `component: "side"`. `side` is not in `COMPONENT_TAGS` at all — it is a COURSE
 * tag — and it flowed straight through to become a filter, matching the course
 * tag by name and half-working, while telling the GENERATOR to write a component
 * of a kind its own vocabulary does not contain. An out-of-enum value that
 * half-works is worse than one that fails: it produces plausible wrong answers
 * and leaves nothing to find.
 *
 * ## Per FIELD, not per object, and never rejecting the call
 *
 * A whole-object `safeParse` is the obvious shape and it is wrong here. One bad
 * enum would discard every other argument the model got right — `query`, the
 * exclusions, the pin — and turn a slightly-wrong search into a contentless one.
 * Refusing the tool call outright is worse still: the turn dies for a field that
 * was optional to begin with.
 *
 * So each declared key is validated alone and dropped alone, which is exactly
 * how an optional field behaves when the model omits it. An unknown key is
 * dropped too — that is what the schema says about it.
 *
 * Every drop is logged with the value, because this is the seam a NEW vocabulary
 * arrives through: a model reaching for `course: "brunch"` or a component kind
 * the list has not got is a signal about the request, and silently discarding it
 * would leave the same invisible gap in a different field.
 */
function validateArgs(
    toolName: string,
    schema: unknown,
    args: Record<string, unknown>
): Record<string, unknown> {
    const shape = (
        schema as { shape?: Record<string, { safeParse(value: unknown): { success: boolean } }> }
    )?.shape;

    // A tool with no zod object schema keeps the previous behaviour rather than
    // having its arguments thrown away by a guard it never opted into.
    if (!shape) return args;

    const kept: Record<string, unknown> = {};
    const rejected: string[] = [];

    for (const [key, value] of Object.entries(args)) {
        const field = shape[key];

        if (!field) {
            rejected.push(`${key} (not in schema)`);
            continue;
        }

        if (field.safeParse(value).success) {
            kept[key] = value;
        } else {
            rejected.push(`${key}=${JSON.stringify(value)}`);
        }
    }

    if (rejected.length > 0) {
        console.warn(
            `[HandleToolCall] ${toolName}: dropped ${rejected.join(", ")} — not accepted by the tool's schema`
        );
    }

    return kept;
}

interface ToolHandler {
    /**
     * Declared as a method rather than a property so parameters stay bivariant:
     * the registry is heterogeneous, and each tool's handler takes its own
     * concrete input type, which would not be assignable to `unknown` under
     * `strictFunctionTypes` if this were an arrow-typed property.
     *
     * `input` is still `unknown`: {@link validateArgs} drops what the schema
     * refuses, but the handler's concrete type is not recoverable here.
     */
    handler(input: unknown, context?: unknown): Promise<ToolResult>;
    /** The zod object the model's arguments are checked against, when declared. */
    definition?: { inputSchema?: unknown };
}

export interface ToolRegistry {
    [name: string]: ToolHandler;
}

/**
 * Optional per-tool context passed through to handlers as a second argument —
 * e.g. streaming callbacks. Keyed by tool name; a tool that doesn't recognise
 * its context simply ignores the extra argument.
 */
export type ToolCallContext = Record<string, unknown>;

/**
 * Execute a single tool call and return the result as a tool message
 */
async function handleSingleToolCall(
    toolCall: ToolCall,
    tools: ToolRegistry,
    argOverrides: Record<string, Record<string, unknown>> = {},
    toolContext: Record<string, ToolCallContext> = {},
    argDefaults: Record<string, Record<string, unknown>> = {},
    argFloors: Record<string, Record<string, unknown>> = {}
): Promise<ChatMessage> {
    const tool = tools[toolCall.function.name];

    if (!tool) {
        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
                error: `Tool ${toolCall.function.name} not found`,
            }),
        };
    }

    try {
        // FOUR layers, and which one an argument belongs in is a statement
        // about who is allowed to change it:
        //
        // - **defaults** sit UNDER the model's arguments, so it wins by saying
        //   something. A saved preference the request may contradict — the
        //   reader's skill level, which "something quick" overrides.
        // - **overrides** sit OVER them, so the model cannot say otherwise at
        //   all. `maxResults: 1`, which is a property of the surface rather
        //   than of the request.
        // - **floors** are UNIONED with the model's array: the caller's entries
        //   are guaranteed present and the model may ADD to them, never remove.
        // - **context** is not an argument at all; see `RecipeSuggestionToolContext`.
        //
        // The floor layer exists because the diet and the blacklist were in
        // `overrides`, and that was half right in a way that took a sweep to
        // find. It protected the property that matters — a model must not be
        // able to drop somebody's allergy — by REPLACING, which also meant the
        // model could never add one. Measured 2026-09-14: the router set
        // `blacklist: ["nuts"]` for "nothing with nuts" in 12 runs out of 12,
        // and the search received `[]` every time, because the client sends the
        // profile's empty list and an override wins. A stated allergy did
        // nothing at all.
        //
        // A union keeps both halves: the profile's entries survive a model that
        // omits them, and an in-conversation "no nuts" reaches the search.
        //
        // `undefined` in the model's arguments would beat a default under a
        // plain spread, so absent keys are stripped first — an unset optional in
        // the tool schema must read as "not answered", not as "answered null".
        const modelArgs = validateArgs(
            toolCall.function.name,
            tool.definition?.inputSchema,
            Object.fromEntries(
                Object.entries(
                    JSON.parse(toolCall.function.arguments) as Record<
                        string,
                        unknown
                    >
                ).filter(([, value]) => value !== undefined)
            )
        );

        const args = {
            ...argDefaults[toolCall.function.name],
            ...modelArgs,
            ...argOverrides[toolCall.function.name],
        };

        // Applied last, so a floor cannot be erased by an override either.
        for (const [key, floor] of Object.entries(
            argFloors[toolCall.function.name] ?? {}
        )) {
            if (!Array.isArray(floor)) {
                throw new Error(
                    `[HandleToolCall] ${toolCall.function.name}: floor \`${key}\` must be an array — a floor is a union, and there is no meaningful union of two scalars.`
                );
            }

            const fromModel = Array.isArray(args[key]) ? (args[key] as unknown[]) : [];

            // Deduplicated case-insensitively on the string form: the model
            // writes "Nuts" where the profile stores "nuts", and two spellings
            // of one restriction reaching `find_recipes` makes its tag count
            // demand two DISTINCT matches — an unsatisfiable filter, which is
            // the failure `findCatalogueRecipes` already de-duplicates against.
            const merged = new Map<string, unknown>();

            for (const item of [...floor, ...fromModel]) {
                if (item === null || item === undefined) continue;

                const dedupeKey = String(item).trim().toLowerCase();
                if (dedupeKey === "" || merged.has(dedupeKey)) continue;

                merged.set(dedupeKey, item);
            }

            args[key] = [...merged.values()];
        }
        const result = await tool.handler(
            args,
            toolContext[toolCall.function.name]
        );

        // Handlers return { content: [{ type: "text", text: "..." }] }
        // Extract the text content
        let resultText = "";
        if (result.content && Array.isArray(result.content)) {
            for (const item of result.content) {
                if (item.type === "text" && item.text) {
                    resultText += item.text;
                }
            }
        }

        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: resultText || JSON.stringify(result),
        };
    } catch (error) {
        console.error(
            `[HandleToolCall] Error executing tool ${toolCall.function.name}:`,
            error
        );

        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
}

/**
 * Execute multiple tool calls in parallel and return tool messages
 */
export async function handleToolCalls(
    toolCalls: ToolCall[],
    tools: ToolRegistry,
    argOverrides: Record<string, Record<string, unknown>> = {},
    toolContext: Record<string, ToolCallContext> = {},
    argDefaults: Record<string, Record<string, unknown>> = {},
    argFloors: Record<string, Record<string, unknown>> = {}
): Promise<ChatMessage[]> {
    const results = await Promise.all(
        toolCalls.map((toolCall) =>
            handleSingleToolCall(
                toolCall,
                tools,
                argOverrides,
                toolContext,
                argDefaults,
                argFloors
            )
        )
    );

    return results;
}
