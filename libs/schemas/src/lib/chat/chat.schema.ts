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
    /**
     * The user's saved skill level, used as the DEFAULT difficulty for anything
     * generated this turn. Unlike the two above it is not forced onto the tool
     * call: a request that asks for something quick, simple or elaborate says
     * so in the message, and the model's own reading of that wins. This only
     * fills the silence — before it existed, every dish suggested in chat was
     * whatever difficulty the generator happened to pick.
     */
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    /**
     * The step the cook is standing on, 1-based, on `/recipes/{id}/chat` only.
     *
     * Sent by cook mode, where the question is nearly always about the thing in
     * the pan right now — "is this brown enough", "how small is finely" — and
     * arrives with no subject the model can resolve. Ignored by the open `/chat`
     * endpoint, which has no recipe to index into.
     *
     * A NUMBER rather than the step's text: the recipe is already fetched
     * server-side, so sending the sentence would be sending back something the
     * prompt is about to quote anyway, and a client and server that both hold
     * the text are two places for it to be wrong.
     */
    focusedStep: z.number().int().positive().optional(),
    /**
     * The thread this turn belongs to, so the prompts recorded from it can be
     * grouped back into a conversation (`profile_prompts.conversation_id`).
     *
     * Client-generated and opaque to the server, which only ever sees one turn
     * and has no way to tell a follow-up from the start of something new — the
     * transcript is re-sent whole on every request, so even "are these the same
     * messages" cannot distinguish a new thread that begins by quoting an old
     * one.
     *
     * **Optional, and history still works without it.** A turn arriving with no
     * thread key is recorded as a loose prompt rather than dropped, which is
     * what keeps this a backward-compatible addition: the client shipping today
     * does not send it, and its prompts are worth keeping anyway.
     */
    conversationId: z.uuid().optional(),
});

// Export types
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
