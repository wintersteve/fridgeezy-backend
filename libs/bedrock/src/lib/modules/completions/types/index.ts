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

export interface BedrockCompletionParams {
    /** Inference profile ID. Defaults to {@link BEDROCK_MODEL}. */
    model?: string;
    /** System prompt. Anthropic takes this as a top-level field, not a message. */
    system?: string;
    /** The user turn. */
    user: string;
    /**
     * Bedrock requires an explicit output cap where the OpenAI path sets none.
     * Defaults to {@link BEDROCK_MAX_TOKENS}.
     */
    maxTokens?: number;
    thinking?: ThinkingType;
    effort?: ThinkingEffort;
}
