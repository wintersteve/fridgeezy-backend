import type OpenAI from "openai";
import { z } from "zod/v4";

interface McpToolDefinition {
    title: string;
    description: string;
    inputSchema: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
}

/**
 * Convert a Zod schema to JSON Schema format for OpenAI
 * Uses Zod v4's built-in toJSONSchema method
 */
function zodToJsonSchema(schema: z.ZodTypeAny): any {
    // Zod v4 has a built-in toJSONSchema method
    if (typeof (schema as any).toJSONSchema === 'function') {
        return (schema as any).toJSONSchema();
    }

    // Fallback for schemas without toJSONSchema
    console.warn('[zodToJsonSchema] Schema does not have toJSONSchema method');
    return { type: "object", properties: {} };
}

/**
 * Convert MCP tool definition to OpenAI function calling format
 */
export function convertMcpToolToOpenAiFunction(
    name: string,
    definition: McpToolDefinition
): OpenAI.ChatCompletionTool {
    const parameters = zodToJsonSchema(definition.inputSchema);

    return {
        type: "function",
        function: {
            name,
            description: definition.description,
            parameters,
        },
    };
}

/**
 * Convert multiple MCP tools to OpenAI tools array
 */
export function convertMcpToolsToOpenAiTools(
    mcpTools: Record<string, { definition: McpToolDefinition }>
): OpenAI.ChatCompletionTool[] {
    return Object.entries(mcpTools).map(([name, tool]) =>
        convertMcpToolToOpenAiFunction(name, tool.definition)
    );
}
