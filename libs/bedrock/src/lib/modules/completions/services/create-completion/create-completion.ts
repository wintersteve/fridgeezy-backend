import { toFinishReason } from "../../../chat/services/translate";
import { bedrock } from "../../../client";
import type {
    BedrockCompletionParams,
    CompletionResult,
    ImageInput,
} from "../../types";
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
 * One-shot completion from Claude on Bedrock, optionally with an image.
 *
 * The non-streaming counterpart to `streamCompletion`, for the short adjudicator
 * calls that parse a single JSON object and for ingredient extraction.
 *
 * **`maxTokens` is not comparable to the OpenAI cap on these call sites.** The
 * adjudicators cap OpenAI at 10-30 tokens, which is ample for `{"same":true}`
 * but is spent by a thinking model before it emits any visible text — Anthropic
 * requires the cap to exceed the thinking budget. `@fridgeezy/llm` therefore
 * takes the two caps as separate numbers rather than one shared value.
 */
export async function createCompletion(
    params: BedrockCompletionParams
): Promise<CompletionResult> {
    const base = buildParams(params);
    const request = params.image
        ? {
              ...base,
              messages: [
                  {
                      role: "user" as const,
                      // Image before text, matching the OpenAI call this
                      // replaces — Anthropic's own guidance is that image-first
                      // ordering reads better for single-image prompts.
                      content: [
                          toAnthropicImageBlock(params.image),
                          { type: "text" as const, text: params.user },
                      ],
                  },
              ],
          }
        : base;

    const message = await bedrock.messages.create(
        request as unknown as MessagesCreateParams
    );

    const typed = message as unknown as {
        content: AnthropicContentBlock[];
        stop_reason?: string | null;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };

    // One object rather than the streaming path's two events, so the counts are
    // read straight off the response instead of accumulated.
    params.onUsage?.({
        inputTokens: typed.usage?.input_tokens ?? 0,
        cachedInputTokens:
            (typed.usage?.cache_read_input_tokens ?? 0) +
            (typed.usage?.cache_creation_input_tokens ?? 0),
        outputTokens: typed.usage?.output_tokens ?? 0,
    });

    return {
        text: toCompletionText(typed.content),
        finishReason: toFinishReason(typed.stop_reason ?? null),
    };
}
