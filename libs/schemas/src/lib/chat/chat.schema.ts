import { z } from "zod/v4";

/**
 * The ceiling on one attached photo, in base64 characters — roughly 3 MB of
 * image.
 *
 * The real limit is the Lambda Function URL's 6 MB *request* cap, which this
 * shares with the whole transcript. Rejecting at 4 M characters leaves the
 * conversation room and, more importantly, turns "the send silently failed" into
 * a 400 that names the problem. The client compresses well below this
 * (`quality: 0.5`, long edge resized) and should never reach it.
 */
const MAX_ATTACHMENT_BASE64 = 4_000_000;

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

/** The image formats both providers accept. */
export const ChatImageMimeSchema = z.enum([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]);

/**
 * One piece of a multimodal message.
 *
 * **Assembled server-side, not sent by the client.** A turn carrying a photo
 * arrives with `attachment` at the top level of the request and an ordinary
 * string `content`; the route moves the image onto the last user message. That
 * is deliberate — see {@link ChatAttachmentSchema} — and it is why every client
 * shipping today still parses against this schema unchanged.
 */
export const ChatContentPartSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({
        type: z.literal("image"),
        /** Raw base64, no `data:` prefix. */
        data: z.string().min(1),
        mimeType: ChatImageMimeSchema.default("image/jpeg"),
    }),
]);

export type ChatContentPart = z.infer<typeof ChatContentPartSchema>;

/**
 * Schema for individual chat messages
 */
export const ChatMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z
        .union([z.string(), z.array(ChatContentPartSchema)])
        .nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
});

/**
 * The visible words of a message, whatever shape its content is in.
 *
 * Every existing reader of `content` assumed a string — the prompt recorder, the
 * routing cache key, the speculative embedding — and each of them wants the text
 * and nothing else. Widening the type without this would have turned three
 * silent `string` reads into `[object Object]` written to the history table.
 */
export const chatMessageText = (
    content: string | ChatContentPart[] | null | undefined
): string => {
    if (!content) return "";
    if (typeof content === "string") return content;

    return content
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
        .trim();
};

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
    /**
     * A photograph the reader attached to THIS turn.
     *
     * ## Why it is a top-level field and not part of the message
     *
     * The obvious shape — an image inside `messages[].content` — puts the
     * payload in the array the client re-sends on every turn, and that array is
     * three things at once on the app side: the request body, the SSE
     * `dependencies`, and (on the chat tab) what gets persisted to disk. A
     * conversation would re-upload every earlier photo on every later turn, the
     * client's `JSON.stringify(dependencies)` would run over megabytes of base64
     * on every render of a streaming reply, and the fourth attachment in a
     * thread would simply exceed the Function URL's 6 MB request limit.
     *
     * At the top level all three problems are gone by construction: **one image
     * per request, maximum, and never in the history.** The route moves it onto
     * the last user message just before the provider call, and the client keeps
     * the model's own description of it for the turns that follow — see the
     * `attachment` SSE frame.
     *
     * Applies to the last USER message. A request whose messages end with an
     * assistant turn carries no attachment anywhere the model would see it, so
     * the route drops it rather than guessing.
     */
    attachment: z
        .object({
            /** Raw base64, no `data:` prefix. */
            data: z.string().min(1).max(MAX_ATTACHMENT_BASE64),
            mimeType: ChatImageMimeSchema.default("image/jpeg"),
        })
        .optional(),
});

// Export types
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatAttachment = NonNullable<
    z.infer<typeof ChatRequestSchema>["attachment"]
>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
