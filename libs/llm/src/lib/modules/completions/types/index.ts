import type {
    ImageInput,
    ThinkingEffort,
    ThinkingType,
} from "@fridgeezy/bedrock";

import type { LlmProvider } from "../../provider";

export type {
    CompletionChunk,
    CompletionResult,
    ImageInput,
} from "@fridgeezy/bedrock";

/**
 * Model IDs are provider-specific and unrelated (`gpt-4.1` vs
 * `eu.anthropic.claude-sonnet-4-6`), so a call site names the one it wants per
 * provider rather than a single string that only makes sense for one of them.
 *
 * `openai` is required because every existing call site already names an OpenAI
 * model, and carrying it over keeps the baseline byte-identical. `bedrock` falls
 * back to `BEDROCK_MODEL` so a model bump is an env change, not a code change.
 */
export interface ModelSelection {
    openai: string;
    bedrock?: string;
}

interface BaseParams {
    model: ModelSelection;
    system?: string;
    user: string;
    /**
     * Which call site this is, for the `[LLM]` usage line.
     *
     * Worth setting even though it is optional: under Bedrock every path runs
     * the same `BEDROCK_MODEL_ID`, so the model field stops distinguishing them
     * and an unlabelled row becomes unattributable. On OpenAI the model happens
     * to separate most call sites today, which is exactly why it is easy to
     * forget until the comparison it was needed for.
     */
    label?: string;
    /** Overrides {@link resolveProvider} for this call — used to A/B the two. */
    provider?: LlmProvider;
    /**
     * **Bedrock only.** Bedrock requires an output cap; OpenAI is deliberately
     * left uncapped here because that is what production does today, and the
     * eval is only meaningful if the baseline is unchanged.
     */
    maxTokens?: number;
    /**
     * Bedrock only; ignored on OpenAI. See `@fridgeezy/bedrock` for the caveat.
     *
     * Unset does not mean "off" — the Bedrock request always carries an explicit
     * mode (`DEFAULT_THINKING`), because the models disagree about what an absent
     * field means. Set this only to depart from that default.
     */
    thinking?: ThinkingType;
    /**
     * Bedrock only; ignored on OpenAI. Unset falls back to `DEFAULT_EFFORT`
     * rather than to the API's own default, which is `high`.
     */
    effort?: ThinkingEffort;
}

export type GenerateStreamParams = BaseParams;

/**
 * Output caps, named per provider for the same reason {@link ModelSelection} is:
 * the two numbers are not conversions of each other.
 *
 * The adjudicator call sites cap OpenAI at 10-30 tokens, which is plenty for
 * `{"same":true}` from a model that answers immediately. A thinking model spends
 * that budget before emitting any visible text, and Anthropic rejects a cap that
 * doesn't clear the thinking budget — so carrying one number across would either
 * truncate every Bedrock verdict or uncap every OpenAI one.
 *
 * Omitting `bedrock` falls back to `BEDROCK_MAX_TOKENS`; omitting `openai`
 * leaves that branch uncapped, which is what the streaming paths do.
 *
 * **Every one-shot call site now names a `bedrock` figure.** That fallback is
 * sized for a full recipe stream, so inheriting it on a call that returns
 * `{"same":true}` meant a thinking model could spend 32k billed output tokens on
 * a one-bit verdict. The fallback is for streaming; one-shot callers pick a
 * number that clears their own thinking allowance and stops there.
 */
export interface TokenLimit {
    /** `max_completion_tokens` on the OpenAI branch. */
    openai?: number;
    /** `max_tokens` on the Bedrock branch, which requires one. */
    bedrock?: number;
}

export interface GenerateCompletionParams
    extends Omit<BaseParams, "maxTokens"> {
    maxTokens?: TokenLimit;
    /**
     * Ask for a single JSON object.
     *
     * **Enforced on OpenAI only**, where it sets
     * `response_format: { type: "json_object" }`. Bedrock has no equivalent
     * field, so there the *prompt* has to ask for JSON — which every call site
     * using this flag already does, since the OpenAI prompts say so too.
     */
    json?: boolean;
    /**
     * Makes this a vision request. The two providers wrap images differently —
     * OpenAI takes a single `image_url` string, Anthropic a `source` object with
     * the media type as its own field — so call sites describe the image once
     * and the branch below shapes it.
     */
    image?: ImageInput;
}
