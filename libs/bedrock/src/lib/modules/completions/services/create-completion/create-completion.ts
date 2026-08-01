import { bedrock } from "../../../client";
import type { BedrockCompletionParams } from "../../types";
import { buildParams, type MessagesCreateParams } from "../request";

/**
 * Anthropic response content blocks, narrowed to what this adapter reads. As
 * with {@link AnthropicStreamEvent}, the SDK's union is wider; naming only the
 * two fields touched here keeps the transform honest without pinning SDK types.
 */
export interface AnthropicContentBlock {
    type: string;
    text?: string;
}

/**
 * Concatenate the visible text of a completed message.
 *
 * Split out from {@link createCompletion} for the same reason
 * `toCompletionChunks` is split out of `streamCompletion`: it can be driven from
 * a recorded response while the account's Anthropic access is still gated, and
 * the failure it guards against is silent downstream — every caller of this path
 * feeds the result to `JSON.parse` inside a try/catch that fails open, so a
 * leaked thinking block turns into a *default verdict*, not an error anyone sees.
 *
 * Only `text` blocks are kept. Thinking arrives as its own block type and is
 * dropped here, which is the non-streaming counterpart of the thinking filter in
 * `toCompletionChunks`.
 */
export const toCompletionText = (content: AnthropicContentBlock[]): string =>
    content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");

/**
 * One-shot completion from Claude on Bedrock, returning the visible text.
 *
 * The non-streaming counterpart to `streamCompletion`, for the short adjudicator
 * calls that parse a single JSON object rather than a JSONL stream.
 *
 * **`maxTokens` is not comparable to the OpenAI cap on these call sites.** The
 * adjudicators cap OpenAI at 10-30 tokens, which is ample for `{"same":true}`
 * but is spent by a thinking model before it emits any visible text — Anthropic
 * requires the cap to exceed the thinking budget. `@fridgeezy/llm` therefore
 * takes the two caps as separate numbers rather than one shared value.
 */
export async function createCompletion(
    params: BedrockCompletionParams
): Promise<string> {
    const message = await bedrock.messages.create(
        buildParams(params) as unknown as MessagesCreateParams
    );

    return toCompletionText(
        (message as unknown as { content: AnthropicContentBlock[] }).content
    );
}
