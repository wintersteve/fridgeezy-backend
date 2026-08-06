/**
 * Chunk shape yielded by {@link streamCompletion}.
 *
 * Deliberately the OpenAI streaming shape rather than Anthropic's: the JSONL
 * plumbing (`processJsonlStream` in `@fridgeezy/streaming-server`, and
 * `extractStableJsonFields` on top of it) is *structurally* typed against
 * `{ choices: [{ delta: { content } }] }` — not against the OpenAI SDK types. So
 * emitting this shape lets the whole streaming stack run on Bedrock unchanged,
 * and lets a call site A/B the two providers without touching its parser.
 */
export interface CompletionChunk {
    choices: { delta?: { content?: string | null } }[];
}

/**
 * How hard the model thinks before answering.
 *
 * **Do not disable thinking on the streaming paths to save tokens.** With it
 * off, Claude can emit `<thinking>` tags into the *visible* response, which
 * corrupts the JSONL line they land on — and a corrupt line is silently
 * dropped, so the failure shows up as missing content, not as an error. Prefer
 * adaptive thinking at low/medium effort.
 *
 * **Leaving this unset is not a neutral choice.** `buildParams` sends an
 * explicit value on every request rather than omitting the field, because the
 * models disagree about what the absence means — Sonnet 4.6 reads it as off,
 * Sonnet 5 as adaptive. See `DEFAULT_THINKING` for the default and why the
 * omission was worth closing.
 */
export type ThinkingType = "adaptive" | "enabled" | "disabled";

/**
 * Thinking depth and overall token spend.
 *
 * Unset is **not** cheap — the API's own default is `high`, which is why
 * `buildParams` names one explicitly (`DEFAULT_EFFORT`). `low` is the setting
 * for the short adjudicator verdicts, where the judgement is one bit and the
 * budget exists only to clear the thinking allowance.
 */
export type ThinkingEffort = "low" | "medium" | "high";

/**
 * An image for a vision request, in whichever form the caller already has.
 *
 * Provider-neutral because the two SDKs disagree about the wrapper but not the
 * payload: OpenAI takes a single `image_url` string (a data URI for base64),
 * Anthropic takes a `source` object that names the media type separately.
 */
export interface ImageInput {
    kind: "base64" | "url";
    /** Raw base64 payload (no data: prefix) when `kind` is base64; else the URL. */
    data: string;
    /** Required for base64 — Anthropic needs it as its own field. */
    mimeType?: string;
}

/**
 * A one-shot completion, with the stop reason kept alongside the text.
 *
 * The reason is not decoration: ingredient extraction caps output and reports a
 * specific "try a clearer image" error when the model is cut off, which is only
 * distinguishable from malformed JSON by this field. Returning a bare string
 * threw that away.
 */
export interface CompletionResult {
    text: string;
    /** Mapped to the OpenAI vocabulary — see `toFinishReason`. */
    finishReason: string | null;
}

/**
 * Token counts as Anthropic reports them, before `@fridgeezy/llm` normalises
 * them against OpenAI's differently-named equivalents.
 *
 * `inputTokens` here excludes the cached portion — Anthropic reports the two as
 * disjoint, where OpenAI folds cache hits into its prompt total. That difference
 * is reconciled in `fromOpenAiUsage`, not here.
 */
export interface BedrockUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}

export interface BedrockCompletionParams {
    /** Inference profile ID. Defaults to {@link BEDROCK_MODEL}. */
    model?: string;
    /**
     * Called once with the token counts for this request.
     *
     * A callback rather than a return value because the streaming path has no
     * return value to put it on: usage arrives split across two events —
     * `message_start` carries the input side, the final `message_delta` the
     * output side — and both land while the generator is still yielding text.
     * Invoked after the last one, so a reader gets one complete record rather
     * than two partial ones.
     */
    onUsage?: (usage: BedrockUsage) => void;
    /** System prompt. Anthropic takes this as a top-level field, not a message. */
    system?: string;
    /** The user turn. */
    user: string;
    /** Optional image, making this a vision request. */
    image?: ImageInput;
    /**
     * Bedrock requires an explicit output cap where the OpenAI path sets none.
     * Defaults to {@link BEDROCK_MAX_TOKENS}.
     */
    maxTokens?: number;
    thinking?: ThinkingType;
    effort?: ThinkingEffort;
}
