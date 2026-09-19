import type { LlmProvider } from "../provider";

/**
 * What one model call cost, in the only terms both providers agree on.
 *
 * Deliberately provider-neutral field names. OpenAI reports
 * `prompt_tokens`/`completion_tokens` with cache hits under
 * `prompt_tokens_details.cached_tokens`; Anthropic reports
 * `input_tokens`/`output_tokens` with `cache_read_input_tokens` alongside. Those
 * are the same three numbers under different names, and normalising them here is
 * the whole point — a comparison that has to remember which provider produced a
 * row is not a comparison.
 */
export interface LlmUsage {
    provider: LlmProvider;
    model: string;
    /** Which call site. Unset means an unlabelled caller — see `reportUsage`. */
    label?: string;
    /** Prompt tokens billed at full rate (cache misses only, where reported). */
    inputTokens: number;
    /**
     * Prompt tokens served from cache.
     *
     * The number this instrumentation exists for. Both providers cache on the
     * longest identical prompt *prefix*, and both fail silently when a prefix is
     * broken — no error, no warning, just full-price input forever. A zero here
     * across repeated calls to the same endpoint means something volatile has
     * been interpolated above the stable block, which is exactly the defect that
     * `buildRecipeSystemPrompt` and promote's `buildSystemPrompt` carried until
     * 2026-08-06.
     */
    cachedInputTokens: number;
    outputTokens: number;
    /**
     * Wall clock from request to last chunk.
     *
     * Worth more here than on a normal API: Lambda bills duration, so on the
     * streaming paths this number is a direct second cost line beside the tokens.
     * On a thinking model it also absorbs the thinking pause, which token counts
     * alone do not show.
     *
     * **It is the COST number, not the experience one** — see
     * {@link firstTokenMs}.
     */
    latencyMs: number;
    /**
     * Wall clock from request to the first chunk carrying CONTENT.
     *
     * The number a reader actually waits: every long call in this app is
     * streamed, and the client draws fields as they land, so "how long until
     * something appears" and "how long until it finished" are different
     * questions with different fixes. {@link latencyMs} alone cannot tell a
     * model that sat silent for fifteen seconds from one that streamed steadily
     * for fifteen — and the first is a routing or prefill problem while the
     * second is a throughput one.
     *
     * Worth having because production says the total is NOT explained by output
     * size: measured over 14 days, `suggestions.promote`'s two slowest calls
     * (19.0 s and 16.7 s) emitted FEWER tokens than its two fastest (8.8 s at
     * ~1,900 tokens), a 3.2x spread in ms-per-token. That is supply-side
     * variance, and this field is what says where in the call it lands.
     *
     * Undefined on a non-streamed call, where it would be `latencyMs` by
     * definition, and on a stream that yielded no content at all.
     *
     * The first chunk with CONTENT, not the first chunk: both providers open
     * with a role-only delta that carries nothing a reader could see.
     */
    firstTokenMs?: number;
    streamed: boolean;
}

/**
 * Emit one structured line per model call.
 *
 * A log line rather than a metrics client on purpose: Lambda ships stdout to
 * CloudWatch already, so this is queryable with Logs Insights the moment it
 * deploys, with no new dependency, no IAM change and nothing to run locally. The
 * `[LLM]` prefix matches the `[Suggestions]` / `[Ingredients]` convention the
 * rest of the app logs under.
 *
 * JSON rather than prose because the consumer is a query, not a person:
 *
 * ```
 * fields @timestamp, label, provider, model, inputTokens, cachedInputTokens, outputTokens, latencyMs, firstTokenMs
 * | filter @message like /\[LLM\]/
 * | stats count(*), avg(firstTokenMs), pct(firstTokenMs, 95), avg(latencyMs), pct(latencyMs, 95), avg(outputTokens) by label
 * ```
 *
 * **This never throws.** It sits on the hot path of every model call, including
 * the streaming ones, and a metrics line that can fail a recipe generation is a
 * worse trade than a metrics line that occasionally goes missing.
 */
export function reportUsage(usage: LlmUsage): void {
    try {
        console.log(`[LLM] ${JSON.stringify(usage)}`);
    } catch {
        // Deliberately silent — see above.
    }
}

/**
 * Normalise OpenAI's usage block.
 *
 * `prompt_tokens` on OpenAI is the *total* prompt, cached portion included, so
 * the cached count is subtracted out to leave the full-rate remainder. Anthropic
 * reports the two as disjoint already, which is why this asymmetry is resolved
 * here rather than at the reader.
 */
export function fromOpenAiUsage(usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
}): Pick<LlmUsage, "inputTokens" | "cachedInputTokens" | "outputTokens"> {
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
        inputTokens: Math.max((usage?.prompt_tokens ?? 0) - cached, 0),
        cachedInputTokens: cached,
        outputTokens: usage?.completion_tokens ?? 0,
    };
}
