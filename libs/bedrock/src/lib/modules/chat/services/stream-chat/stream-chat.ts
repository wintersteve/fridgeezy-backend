import { bedrock, BEDROCK_MODEL } from "../../../client";
import { BEDROCK_MAX_TOKENS } from "../../../completions/services/request";
import type {
    AnthropicChatEvent,
    BedrockChatParams,
    ChatStreamEvent,
} from "../../types";
import {
    toAnthropicMessages,
    toAnthropicTools,
    toChatStreamEvents,
} from "../translate";

type MessagesCreateParams = Parameters<typeof bedrock.messages.create>[0];

/**
 * Multi-turn chat with tool calling on Claude via Bedrock, emitting the same
 * {@link ChatStreamEvent} sequence as the OpenAI path.
 *
 * This function is only the live call. Every shape decision lives in the pure
 * translators next door, so the parts that can be wrong are the parts that can
 * be tested without a model — which is the whole game while Anthropic access is
 * gated on this account.
 *
 * Errors are yielded as an `error` event rather than thrown, matching the OpenAI
 * path: `process-chat` writes that straight to the SSE stream, and a throw here
 * would instead abort a response the client has already started rendering.
 */
export async function* streamChatCompletion(
    params: BedrockChatParams
): AsyncGenerator<ChatStreamEvent> {
    try {
        const { system, messages } = toAnthropicMessages(params.messages);
        const tools = params.tools?.length
            ? toAnthropicTools(params.tools)
            : undefined;

        const stream = await bedrock.messages.create({
            model: params.model ?? BEDROCK_MODEL,
            max_tokens: params.maxTokens ?? BEDROCK_MAX_TOKENS,
            ...(system ? { system } : {}),
            messages,
            ...(tools ? { tools } : {}),
            ...(params.temperature !== undefined
                ? { temperature: params.temperature }
                : {}),
            ...(params.thinking ? { thinking: { type: params.thinking } } : {}),
            ...(params.effort ? { output_config: { effort: params.effort } } : {}),
            stream: true,
        } as unknown as MessagesCreateParams);

        yield* toChatStreamEvents(stream as AsyncIterable<AnthropicChatEvent>);
    } catch (error) {
        console.error("[BedrockChat] Error:", error);
        yield {
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
