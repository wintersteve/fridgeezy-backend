import { z } from "zod/v4";

/**
 * Schema for tool call functions
 */
export const ToolCallFunctionSchema = z.object({
    name: z.string(),
    arguments: z.string(),
});

/**
 * Schema for tool calls in chat messages
 */
export const ToolCallSchema = z.object({
    id: z.string(),
    type: z.literal("function"),
    function: ToolCallFunctionSchema,
});

/**
 * Schema for individual chat messages
 */
export const ChatMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
});

/**
 * Schema for chat request
 */
export const ChatRequestSchema = z.object({
    messages: z.array(ChatMessageSchema).min(1),
    stream: z.boolean().default(true),
    model: z.string().default("gpt-4o"),
    temperature: z.number().min(0).max(2).default(0.7).optional(),
    /**
     * The user's dietary tags (e.g. "vegan", "gluten_free"). Applied to any
     * recipe suggestions generated this turn so they respect the user's diet.
     */
    dietaryRestrictions: z.array(z.string()).optional(),
    /**
     * Ingredients the user never wants suggested (allergies / dislikes).
     * Recipes that normally contain any of these are excluded.
     */
    blacklist: z.array(z.string()).optional(),
});

// Export types
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
