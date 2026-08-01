import {
    generateChatStream,
    type ChatStreamEvent,
    type LlmProvider,
    type OpenAiShapedTool,
} from "@fridgeezy/llm";
import type { ChatMessage } from "@fridgeezy/schemas";

export type { ChatStreamEvent };

export interface ChatCompletionOptions {
    /**
     * Retained for the request schema's `stream` flag, but no longer branches
     * here. Both providers are consumed as a stream and the caller assembles
     * the reply from the events either way; a non-streaming OpenAI call only
     * ever produced the same event sequence in one burst, and Anthropic has no
     * separate non-streaming tool-call shape worth a second code path.
     */
    stream: boolean;
    model: string;
    temperature?: number;
    /** Overrides `LLM_PROVIDER` for this call, so the two can be A/B'd. */
    provider?: LlmProvider;
}

/**
 * Chat completion with tool calling, over whichever provider `LLM_PROVIDER`
 * selects.
 *
 * A thin wrapper now: the provider differences — system prompt placement, tool
 * schema shape, tool results, and how tool calls stream — all live in
 * `@fridgeezy/llm` and `@fridgeezy/bedrock`. What is left here is naming the
 * model per provider, which is the one thing a call site must still decide.
 */
export async function* createChatCompletion(
    messages: ChatMessage[],
    tools: OpenAiShapedTool[],
    options: ChatCompletionOptions
): AsyncGenerator<ChatStreamEvent> {
    yield* generateChatStream({
        messages,
        tools,
        // `model` comes off the request, which defaults to gpt-4o in
        // ChatRequestSchema — so the OpenAI side keeps its existing behaviour
        // and Bedrock falls through to BEDROCK_MODEL_ID.
        model: { openai: options.model },
        temperature: options.temperature ?? 0.7,
        provider: options.provider,
    });
}
