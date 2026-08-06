import { bedrock } from "../../../client";
import type {
    BedrockCompletionParams,
    BedrockUsage,
    CompletionChunk,
} from "../../types";
import { buildParams, type MessagesCreateParams } from "../request";

/**
 * Anthropic usage as it arrives on the wire, split across two events.
 *
 * `message_start` carries the input side (including the cache split);
 * `message_delta` carries the running output count. Both fields are optional
 * because a given event only populates its own half.
 */
interface AnthropicUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

/**
 * Anthropic streaming events, narrowed to what this adapter reads. The SDK's own
 * event union is wider; this keeps the transform honest about the fields it
 * touches without importing (and pinning) the SDK's types.
 */
export interface AnthropicStreamEvent {
    type: string;
    delta?: { type?: string; text?: string };
    /** Present on `message_delta`. */
    usage?: AnthropicUsage;
    /** Present on `message_start`. */
    message?: { usage?: AnthropicUsage };
}

/**
 * Translate Anthropic streaming events into OpenAI-shaped chunks.
 *
 * Split out from {@link streamCompletion} so it can be exercised against
 * recorded event sequences without a live model — which matters because the
 * account's Bedrock access is still gated, and because the failure this guards
 * against (a text delta being dropped or a thinking delta leaking through) is
 * silent downstream: `processJsonlStream` skips a malformed line rather than
 * raising.
 *
 * Only text deltas are emitted. Thinking blocks arrive as a different delta type
 * and are dropped here — if a `<thinking>` tag ever shows up downstream, it
 * leaked into the visible text rather than slipping past this filter, which is
 * the failure the Phase 0 eval harness counts.
 *
 * Empty text deltas are passed through rather than skipped: `processJsonlStream`
 * already ignores falsy content, and swallowing them here would hide a provider
 * behaviour change behind an adapter that looked fine.
 *
 * `onUsage` observes the token counts without them ever entering the chunk
 * stream — usage events are not text and must not become JSONL. It fires once,
 * after the stream ends, because the counts arrive in two halves: the input side
 * on `message_start`, the output side on the final `message_delta`.
 */
export async function* toCompletionChunks(
    events: AsyncIterable<AnthropicStreamEvent>,
    onUsage?: (usage: BedrockUsage) => void
): AsyncGenerator<CompletionChunk> {
    const totals: BedrockUsage = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
    };

    for await (const event of events) {
        if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
        ) {
            yield { choices: [{ delta: { content: event.delta.text ?? "" } }] };
            continue;
        }

        const usage = event.message?.usage ?? event.usage;
        if (!usage) continue;

        // Last write wins rather than accumulating: `message_delta` reports the
        // running output total, not an increment, so summing would multiply it.
        if (usage.input_tokens != null) totals.inputTokens = usage.input_tokens;
        if (usage.output_tokens != null) {
            totals.outputTokens = usage.output_tokens;
        }

        // Reads and writes both count as "not billed at full input rate", but
        // they are priced differently — a write costs *more* than an uncached
        // token. Summed here because the reader's question is "did the prefix
        // cache at all", and a run of writes with no reads answers that as
        // clearly as a zero would.
        const cached =
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
        if (cached > 0) totals.cachedInputTokens = cached;
    }

    onUsage?.(totals);
}

/**
 * Stream a completion from Claude on Bedrock as OpenAI-shaped chunks, so it can
 * be handed straight to `processJsonlStream` in place of an OpenAI stream.
 *
 * The event translation lives in {@link toCompletionChunks}; this function is
 * only the live call around it.
 */
export async function* streamCompletion(
    params: BedrockCompletionParams
): AsyncGenerator<CompletionChunk> {
    const stream = await bedrock.messages.create({
        ...buildParams(params),
        stream: true,
    } as unknown as MessagesCreateParams);

    yield* toCompletionChunks(
        stream as AsyncIterable<AnthropicStreamEvent>,
        params.onUsage
    );
}
