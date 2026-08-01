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
 */
export type ThinkingType = "adaptive" | "enabled" | "disabled";

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

export interface BedrockCompletionParams {
    /** Inference profile ID. Defaults to {@link BEDROCK_MODEL}. */
    model?: string;
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
