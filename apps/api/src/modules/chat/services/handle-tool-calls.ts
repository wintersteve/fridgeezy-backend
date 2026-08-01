import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";

/**
 * What a tool handler resolves to. Handlers answer in the content-block shape
 * (`{ content: [{ type: "text", text }] }`); anything else is stringified whole
 * by the caller, so the fields are optional rather than assumed.
 */
export interface ToolResult {
    content?: Array<{ type: string; text?: string }>;
}

interface ToolHandler {
    /**
     * Declared as a method rather than a property so parameters stay bivariant:
     * the registry is heterogeneous, and each tool's handler takes its own
     * concrete input type, which would not be assignable to `unknown` under
     * `strictFunctionTypes` if this were an arrow-typed property.
     *
     * `input` really is unknown here — it arrives as `JSON.parse` output of the
     * model's tool-call arguments, which nothing has validated yet.
     */
    handler(input: unknown, context?: unknown): Promise<ToolResult>;
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
    toolContext: Record<string, ToolCallContext> = {}
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
        const args = {
            ...JSON.parse(toolCall.function.arguments),
            ...argOverrides[toolCall.function.name],
        };
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
                error:
                    error instanceof Error ? error.message : "Unknown error",
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
    toolContext: Record<string, ToolCallContext> = {}
): Promise<ChatMessage[]> {
    const results = await Promise.all(
        toolCalls.map((toolCall) =>
            handleSingleToolCall(toolCall, tools, argOverrides, toolContext)
        )
    );

    return results;
}
