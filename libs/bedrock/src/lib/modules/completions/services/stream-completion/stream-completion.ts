import { bedrock, BEDROCK_MODEL } from "../../../client";
import type { BedrockCompletionParams, CompletionChunk } from "../../types";

/**
 * Bedrock requires an explicit output cap where the OpenAI path sets none.
 * Sized for the longest artefact (a full recipe JSONL), not for the average.
 */
export const BEDROCK_MAX_TOKENS = 16_000;

/**
 * Anthropic streaming events, narrowed to what this adapter reads. The SDK's own
 * event union is wider; this keeps the `for await` body honest about the two
 * fields it touches without importing (and pinning) the SDK's types.
 */
interface AnthropicStreamEvent {
    type: string;
    delta?: { type?: string; text?: string };
}

/**
 * Build the request body. `thinking`/`output_config` are newer than the
 * installed SDK's types, so the cast sits here at the parameter boundary — the
 * wire fields are correct — rather than on the response, where it would mask
 * real shape errors.
 */
const buildParams = (params: BedrockCompletionParams) => ({
    model: params.model ?? BEDROCK_MODEL,
    max_tokens: params.maxTokens ?? BEDROCK_MAX_TOKENS,
    ...(params.system ? { system: params.system } : {}),
    messages: [{ role: "user" as const, content: params.user }],
    ...(params.thinking ? { thinking: { type: params.thinking } } : {}),
    ...(params.effort ? { output_config: { effort: params.effort } } : {}),
});

type MessagesCreateParams = Parameters<typeof bedrock.messages.create>[0];

/**
 * Stream a completion from Claude on Bedrock as OpenAI-shaped chunks, so it can
 * be handed straight to `processJsonlStream` in place of an OpenAI stream.
 *
 * Only text deltas are emitted. Thinking blocks arrive as a different delta type
 * and are dropped here — if a `<thinking>` tag ever shows up downstream, it
 * leaked into the visible text rather than slipping past this filter, which is
 * the failure the Phase 0 eval harness counts.
 */
export async function* streamCompletion(
    params: BedrockCompletionParams
): AsyncGenerator<CompletionChunk> {
    const stream = await bedrock.messages.create({
        ...buildParams(params),
        stream: true,
    } as unknown as MessagesCreateParams);

    for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
        if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
        ) {
            yield { choices: [{ delta: { content: event.delta.text ?? "" } }] };
        }
    }
}
