import type OpenAI from "openai";
import { z } from "zod/v4";

export interface ToolDefinition {
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
 * Convert a tool definition to OpenAI function calling format
 */
export function convertToolToOpenAiFunction(
    name: string,
    definition: ToolDefinition
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
 * Convert multiple tools to an OpenAI tools array
 */
export function convertToolsToOpenAiTools(
    tools: Record<string, { definition: ToolDefinition }>
): OpenAI.ChatCompletionTool[] {
    return Object.entries(tools).map(([name, tool]) =>
        convertToolToOpenAiFunction(name, tool.definition)
    );
}
