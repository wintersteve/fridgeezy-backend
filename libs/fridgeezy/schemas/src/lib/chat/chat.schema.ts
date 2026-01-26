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
});

/**
 * Schema for chat choice
 */
export const ChatChoiceSchema = z.object({
    index: z.number(),
    message: ChatMessageSchema,
    finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]).nullable(),
});

/**
 * Schema for token usage
 */
export const TokenUsageSchema = z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
});

/**
 * Schema for chat response (non-streaming)
 */
export const ChatResponseSchema = z.object({
    id: z.string(),
    object: z.literal("chat.completion"),
    created: z.number(),
    model: z.string(),
    choices: z.array(ChatChoiceSchema),
    usage: TokenUsageSchema,
});

/**
 * Schema for streaming chat delta
 */
export const ChatDeltaSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]).optional(),
    content: z.string().nullable().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
});

/**
 * Schema for streaming chat choice
 */
export const ChatStreamChoiceSchema = z.object({
    index: z.number(),
    delta: ChatDeltaSchema,
    finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]).nullable(),
});

/**
 * Schema for streaming chat chunk
 */
export const ChatStreamChunkSchema = z.object({
    id: z.string(),
    object: z.literal("chat.completion.chunk"),
    created: z.number(),
    model: z.string(),
    choices: z.array(ChatStreamChoiceSchema),
});

// Export types
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type ChatStreamChunk = z.infer<typeof ChatStreamChunkSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ChatDelta = z.infer<typeof ChatDeltaSchema>;
