import type { ChatMessage, ToolCall } from "@fridgeezy/schemas";

interface McpToolHandler {
    handler: (input: any) => Promise<any>;
}

interface McpTools {
    [name: string]: McpToolHandler;
}

/**
 * Execute a single tool call and return the result as a tool message
 */
async function handleSingleToolCall(
    toolCall: ToolCall,
    mcpTools: McpTools
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
        const args = JSON.parse(toolCall.function.arguments);
        const mcpResult = await tool.handler(args);

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
    mcpTools: McpTools
): Promise<ChatMessage[]> {
    const results = await Promise.all(
        toolCalls.map((toolCall) => handleSingleToolCall(toolCall, mcpTools))
    );

    return results;
}
