import { chatMessageText } from "@fridgeezy/schemas";
import type { ChatContentPart, ChatMessage, ToolCall } from "@fridgeezy/schemas";

import type { ImageInput } from "../../../completions/types";

import type {
    AnthropicChatEvent,
    AnthropicContentBlockParam,
    AnthropicMessage,
    AnthropicTool,
    ChatStreamEvent,
    OpenAiShapedTool,
    TranslatedConversation,
} from "../../types";

/**
 * A multimodal message's parts as Anthropic content blocks.
 *
 * Images first, then the text, regardless of the order the parts arrived in —
 * Anthropic's own guidance for a question about a picture, and the only case
 * this app produces. Empty text parts are dropped rather than sent: an empty
 * `text` block is rejected outright, and an attachment with no sentence beside
 * it is a shape the client deliberately allows.
 */
function toAnthropicBlocks(
    parts: ChatContentPart[]
): AnthropicContentBlockParam[] {
    const images = parts.flatMap((part) =>
        part.type === "image"
            ? [
                  toAnthropicImageBlock({
                      kind: "base64",
                      data: part.data,
                      mimeType: part.mimeType,
                  }),
              ]
            : []
    );

    const text = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();

    return [...images, ...(text ? [{ type: "text" as const, text }] : [])];
}

/**
 * Anthropic takes the system prompt as a **top-level field**, not as a message
 * in the list, so system turns are lifted out here.
 *
 * Multiple system turns are joined rather than dropped: `process-chat` prepends
 * one system message and then appends a second to steer the acknowledgement and
 * the summary, so more than one is the normal case for this app, not an edge.
 */
export function toAnthropicMessages(
    messages: ChatMessage[]
): TranslatedConversation {
    const system: string[] = [];
    const out: AnthropicMessage[] = [];

    for (const message of messages) {
        if (message.role === "system") {
            const text = chatMessageText(message.content);
            if (text) system.push(text);
            continue;
        }

        if (message.role === "tool") {
            // A tool result is a `user` turn carrying a `tool_result` block —
            // Anthropic has no `tool` role. Consecutive results MUST be merged
            // into a single user message: the API rejects a conversation where
            // one assistant turn with two tool_use blocks is answered by two
            // separate user messages.
            const previous = out[out.length - 1];
            const block = {
                type: "tool_result" as const,
                tool_use_id: message.tool_call_id ?? "",
                content: chatMessageText(message.content),
            };

            if (
                previous?.role === "user" &&
                Array.isArray(previous.content) &&
                previous.content.every((item) => item.type === "tool_result")
            ) {
                previous.content.push(block);
            } else {
                out.push({ role: "user", content: [block] });
            }

            continue;
        }

        if (message.role === "assistant" && message.tool_calls?.length) {
            // Anthropic wants the assistant's own tool calls echoed back as
            // `tool_use` blocks, and `input` as a parsed object — where OpenAI
            // carries `arguments` as a JSON *string*. A malformed string here
            // would reject the whole request, so it degrades to `{}` rather
            // than throwing mid-conversation.
            const blocks: AnthropicMessage["content"] = [];

            const text = chatMessageText(message.content);

            if (text) blocks.push({ type: "text", text });

            for (const call of message.tool_calls) {
                let input: unknown = {};

                try {
                    input = JSON.parse(call.function.arguments || "{}");
                } catch {
                    input = {};
                }

                blocks.push({
                    type: "tool_use",
                    id: call.id,
                    name: call.function.name,
                    input,
                });
            }

            out.push({ role: "assistant", content: blocks });
            continue;
        }

        // Anthropic rejects empty-string content, which OpenAI tolerates.
        if (!message.content) continue;

        // A multimodal turn: the route put an image part on the last user
        // message. Anthropic wants the picture BEFORE the words — its own
        // guidance, and it measurably changes what the model attends to when
        // the text is a question about the picture, which here it always is.
        if (Array.isArray(message.content)) {
            const blocks = toAnthropicBlocks(message.content);

            if (blocks.length === 0) continue;

            out.push({
                role: message.role === "assistant" ? "assistant" : "user",
                content: blocks,
            });
            continue;
        }

        out.push({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.content,
        });
    }

    return { system: system.join("\n\n") || undefined, messages: out };
}

/**
 * OpenAI nests the tool under `function` and calls its schema `parameters`;
 * Anthropic flattens it and calls the same schema `input_schema`. Nothing else
 * differs, which is why the call sites can keep defining tools once.
 */
export function toAnthropicTools(tools: OpenAiShapedTool[]): AnthropicTool[] {
    return tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
    }));
}

/**
 * Anthropic stop reasons, mapped onto the OpenAI vocabulary the consumers of
 * {@link ChatStreamEvent} already branch on. `process-chat` tests
 * `finish_reason === "tool_calls"` to decide whether to run tools, so getting
 * this mapping wrong silently disables tool calling rather than erroring.
 */
export function toFinishReason(stopReason: string | null): string | null {
    if (stopReason === "tool_use") return "tool_calls";
    if (stopReason === "end_turn" || stopReason === "stop_sequence") return "stop";
    if (stopReason === "max_tokens") return "length";
    return stopReason;
}

/**
 * Translate an Anthropic chat stream into the same {@link ChatStreamEvent}
 * sequence the OpenAI path produces.
 *
 * Split out from the live call for the reason every translator in this lib is:
 * Anthropic models are gated on this AWS account, so the only way to verify the
 * translation is to drive it from recorded events. See
 * `apps/api/src/evals/model-migration/streaming-conformance.check.ts`.
 *
 * The two shapes are structured very differently. OpenAI streams tool calls as
 * `delta.tool_calls[]` fragments keyed by an **index**, with the arguments
 * arriving as a JSON string built up across chunks. Anthropic streams each tool
 * call as a numbered *content block*: `content_block_start` names it,
 * `input_json_delta` fragments carry its arguments, `content_block_stop` closes
 * it. Both end up as one `tool_calls` event carrying `ToolCall[]`.
 *
 * Thinking deltas are dropped, as in `toCompletionChunks` — with thinking on,
 * they arrive interleaved with visible text and would otherwise be streamed to
 * the user as if the model had said them.
 */
export async function* toChatStreamEvents(
    events: AsyncIterable<AnthropicChatEvent>
): AsyncGenerator<ChatStreamEvent> {
    // Keyed by content-block index. Anthropic guarantees blocks are opened and
    // closed in order, but text and tool_use blocks interleave, so a map is
    // safer than positional state.
    const toolCalls = new Map<number, ToolCall>();
    let finishReason: string | null = null;

    for await (const event of events) {
        if (event.type === "content_block_start") {
            const block = event.content_block;

            if (block?.type === "tool_use") {
                toolCalls.set(event.index ?? 0, {
                    id: block.id ?? "",
                    type: "function",
                    // Anthropic sends `input` as an object once complete, but
                    // streams it as JSON text; ToolCall carries the string form
                    // because that is what the handler layer JSON.parses.
                    function: { name: block.name ?? "", arguments: "" },
                });
            }

            continue;
        }

        if (event.type === "content_block_delta") {
            const delta = event.delta;

            if (delta?.type === "text_delta" && delta.text) {
                yield { type: "chunk", delta: delta.text };
                continue;
            }

            if (delta?.type === "input_json_delta") {
                const call = toolCalls.get(event.index ?? 0);

                if (call) call.function.arguments += delta.partial_json ?? "";
            }

            // thinking_delta and signature_delta fall through: never visible.
            continue;
        }

        if (event.type === "message_delta" && event.delta?.stop_reason) {
            finishReason = toFinishReason(event.delta.stop_reason);
        }
    }

    if (toolCalls.size > 0) {
        // Emitted in block order so the tool results line up with the order the
        // model asked for them, matching the OpenAI path's index ordering.
        const ordered = [...toolCalls.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, call]) => call);

        yield { type: "tool_calls", tool_calls: ordered };
    }

    yield { type: "done", finish_reason: finishReason };
}

/**
 * Wrap an image the way Anthropic expects.
 *
 * OpenAI takes one `image_url` string and infers the media type from the data
 * URI; Anthropic wants a `source` object naming the type separately. A base64
 * payload arriving *with* a `data:` prefix is stripped rather than rejected —
 * callers reasonably have it either way, and sending the prefix inside the
 * base64 field fails server-side with an opaque error.
 *
 * **No `detail` equivalent.** OpenAI's `detail: "high"` has no counterpart:
 * Anthropic decides resolution itself, and Sonnet 4.6 caps the long edge at
 * 1568px where Sonnet 5 allows 2576px. Extraction accuracy on detailed images
 * is therefore a per-model question, not something this translation preserves —
 * re-measure it rather than assuming it carries over.
 */
export function toAnthropicImageBlock(image: ImageInput) {
    if (image.kind === "url") {
        return { type: "image" as const, source: { type: "url" as const, url: image.data } };
    }

    return {
        type: "image" as const,
        source: {
            type: "base64" as const,
            media_type: image.mimeType ?? "image/jpeg",
            data: image.data.replace(/^data:[^;]+;base64,/, ""),
        },
    };
}
