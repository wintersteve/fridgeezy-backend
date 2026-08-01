import type OpenAI from "openai";
import { z } from "zod/v4";

export interface ToolDefinition {
    title: string;
    description: string;
    inputSchema: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
}

/**
 * Convert a Zod schema to the JSON Schema OpenAI expects for a function's
 * parameters, using Zod v4's built-in `toJSONSchema`.
 *
 * The fallback is a real hazard rather than a safety net: it returns a schema
 * with **no properties**, so the model would be offered the tool with no
 * arguments at all and the failure would look like the model "forgetting" to
 * pass them. Verified against the installed Zod that the method exists and the
 * live tool converts with its full parameter set, so the branch is unreached —
 * it stays only to keep a version bump from crashing the route, and it warns
 * loudly if it ever fires.
 */
type JsonSchemaObject = Record<string, unknown>;

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
    const withMethod = schema as { toJSONSchema?: () => JsonSchemaObject };

    if (typeof withMethod.toJSONSchema === "function") {
        return withMethod.toJSONSchema();
    }

    console.warn(
        "[zodToJsonSchema] Schema has no toJSONSchema method — the tool will be exposed WITHOUT parameters"
    );
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
