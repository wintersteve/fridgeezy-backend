import { chatMessageText } from "@fridgeezy/schemas";
import type { ChatContentPart, ChatMessage } from "@fridgeezy/schemas";

import { resolveProvider } from "../../../provider";
import type { ChatStreamEvent, GenerateChatStreamParams } from "../../types";

/**
 * A message's content as OpenAI wants it: a plain string, or the content-part
 * array a multimodal turn needs.
 *
 * The image goes FIRST and the words after it, matching the Anthropic branch —
 * a question about a picture reads better to both models with the picture
 * already in view, and having the two providers disagree about ordering is a
 * difference that would only ever show up as a quality drift nobody could
 * attribute.
 *
 * Base64 is wrapped as a data URI because that is OpenAI's only base64 form; the
 * media type it names is the same one Anthropic takes as its own field.
 * `detail: "high"` has no Anthropic counterpart and is set here alone —
 * deliberately, since the two providers already decide resolution differently.
 */
const toOpenAiContent = (content: ChatMessage["content"]) => {
    if (!Array.isArray(content)) return content ?? "";

    const images = content.flatMap((part: ChatContentPart) =>
        part.type === "image"
            ? [
                  {
                      type: "image_url" as const,
                      image_url: {
                          url: `data:${part.mimeType};base64,${part.data.replace(/^data:[^;]+;base64,/, "")}`,
                          detail: "high" as const,
                      },
                  },
              ]
            : []
    );

    const text = chatMessageText(content);

    return [
        ...images,
        ...(text ? [{ type: "text" as const, text }] : []),
    ] as never;
};

/**
 * Multi-turn chat with tool calling, from whichever provider is active, as one
 * {@link ChatStreamEvent} sequence.
 *
 * This is the seam the other two entry points could not cover. `generateStream`
 * takes a system+user pair and yields text; chat needs conversation history,
 * tool definitions, tool results fed back in, and tool calls streamed out. The
 * two SDKs disagree about all four:
 *
 * - **System prompt.** OpenAI takes it as a message; Anthropic as a top-level
 *   field. This app sends more than one, so they are joined rather than picked.
 * - **Tool results.** OpenAI has a `tool` role; Anthropic has none — a result is
 *   a `user` turn carrying `tool_result` blocks, and several results for one
 *   assistant turn must arrive in a *single* message.
 * - **Tool schemas.** `function.parameters` versus a flat `input_schema`.
 * - **Streaming tool calls.** OpenAI fragments them by index inside
 *   `delta.tool_calls`; Anthropic streams each as a numbered content block with
 *   `input_json_delta` fragments.
 *
 * All four translations live in `@fridgeezy/bedrock`'s pure translators, so they
 * can be verified against recorded events while Anthropic access is gated. This
 * function only chooses a provider.
 *
 * Clients are imported lazily on the branch that uses them — `libs/openai`
 * throws at import on a missing key.
 */
export async function* generateChatStream(
    params: GenerateChatStreamParams
): AsyncGenerator<ChatStreamEvent> {
    if (resolveProvider(params.provider) === "bedrock") {
        const { streamChatCompletion } = await import("@fridgeezy/bedrock");

        yield* streamChatCompletion({
            messages: params.messages,
            tools: params.tools,
            model: params.model.bedrock,
            maxTokens: params.maxTokens?.bedrock,
            temperature: params.temperature,
            thinking: params.thinking,
            effort: params.effort,
        });

        return;
    }

    const { openai } = await import("@fridgeezy/openai");

    try {
        // OpenAI takes the conversation almost as-is; only the tool-call and
        // tool-result turns need their optional fields made concrete.
        //
        // A `tool` turn's content is a JSON result and a tool-call turn's is
        // prose, so both are flattened to text — only a user turn is ever
        // multimodal, and only the last one of those.
        const messages = params.messages.map((message) => {
            if (message.role === "tool") {
                return {
                    role: "tool" as const,
                    content: chatMessageText(message.content),
                    tool_call_id: message.tool_call_id ?? "",
                };
            }

            if (message.tool_calls?.length) {
                return {
                    role: "assistant" as const,
                    content: chatMessageText(message.content) || null,
                    tool_calls: message.tool_calls.map((call) => ({
                        id: call.id,
                        type: "function" as const,
                        function: {
                            name: call.function.name,
                            arguments: call.function.arguments,
                        },
                    })),
                };
            }

            return {
                role: message.role as "system" | "user" | "assistant",
                content: toOpenAiContent(message.content),
            };
        });

        const stream = await openai.chat.completions.create({
            model: params.model.openai,
            messages,
            ...(params.tools?.length ? { tools: params.tools } : {}),
            ...(params.temperature !== undefined
                ? { temperature: params.temperature }
                : {}),
            ...(params.maxTokens?.openai
                ? { max_completion_tokens: params.maxTokens.openai }
                : {}),
            stream: true,
        });

        // Sparse while streaming: OpenAI addresses tool-call fragments by index
        // and may open a later index before an earlier one is complete, so holes
        // are filtered out before yielding.
        const toolCalls: GenerateChatStreamParams["messages"][number]["tool_calls"] =
            [];

        for await (const chunk of stream) {
            const choice = chunk.choices[0];

            if (!choice) continue;

            if (choice.delta?.content) {
                yield { type: "chunk", delta: choice.delta.content };
            }

            for (const fragment of choice.delta?.tool_calls ?? []) {
                const existing = toolCalls[fragment.index];

                if (!existing) {
                    toolCalls[fragment.index] = {
                        id: fragment.id ?? "",
                        type: "function",
                        function: {
                            name: fragment.function?.name ?? "",
                            arguments: fragment.function?.arguments ?? "",
                        },
                    };
                    continue;
                }

                // Both halves arrive in fragments; the name is usually whole in
                // the first, but the arguments never are.
                existing.function.name += fragment.function?.name ?? "";
                existing.function.arguments += fragment.function?.arguments ?? "";
            }

            if (choice.finish_reason) {
                if (choice.finish_reason === "tool_calls") {
                    yield {
                        type: "tool_calls",
                        tool_calls: toolCalls.filter(Boolean),
                    };
                }

                yield { type: "done", finish_reason: choice.finish_reason };
            }
        }
    } catch (error) {
        console.error("[generateChatStream] Error:", error);
        yield {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
