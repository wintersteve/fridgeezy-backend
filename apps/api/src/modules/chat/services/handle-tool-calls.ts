import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";

interface McpToolHandler {
    handler: (input: any, context?: any) => Promise<any>;
}

interface McpTools {
    [name: string]: McpToolHandler;
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
    mcpTools: McpTools,
    argOverrides: Record<string, Record<string, unknown>> = {},
    toolContext: Record<string, ToolCallContext> = {}
): Promise<ChatMessage> {
    const tool = mcpTools[toolCall.function.name];

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
        const mcpResult = await tool.handler(
            args,
            toolContext[toolCall.function.name]
        );

        // MCP tools return { content: [{ type: "text", text: "..." }] }
        // Extract the text content
        let resultText = "";
        if (mcpResult.content && Array.isArray(mcpResult.content)) {
            for (const item of mcpResult.content) {
                if (item.type === "text" && item.text) {
                    resultText += item.text;
                }
            }
        }

        return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: resultText || JSON.stringify(mcpResult),
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
    mcpTools: McpTools,
    argOverrides: Record<string, Record<string, unknown>> = {},
    toolContext: Record<string, ToolCallContext> = {}
): Promise<ChatMessage[]> {
    const results = await Promise.all(
        toolCalls.map((toolCall) =>
            handleSingleToolCall(
                toolCall,
                mcpTools,
                argOverrides,
                toolContext
            )
        )
    );

    return results;
}
