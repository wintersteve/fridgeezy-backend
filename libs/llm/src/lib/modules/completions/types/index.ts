import type { ThinkingEffort, ThinkingType } from "@fridgeezy/bedrock";

import type { LlmProvider } from "../../provider";

export type { CompletionChunk } from "@fridgeezy/bedrock";

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
    /** Overrides {@link resolveProvider} for this call — used to A/B the two. */
    provider?: LlmProvider;
    /**
     * **Bedrock only.** Bedrock requires an output cap; OpenAI is deliberately
     * left uncapped here because that is what production does today, and the
     * eval is only meaningful if the baseline is unchanged.
     */
    maxTokens?: number;
    /** Bedrock only; ignored on OpenAI. See `@fridgeezy/bedrock` for the caveat. */
    thinking?: ThinkingType;
    /** Bedrock only; ignored on OpenAI. */
    effort?: ThinkingEffort;
}

export type GenerateStreamParams = BaseParams;

export interface GenerateCompletionParams extends BaseParams {
    /**
     * Ask for a JSON object back.
     *
     * **Not equivalent across providers.** On OpenAI this sets
     * `response_format: { type: "json_object" }`, which the API enforces. Bedrock
     * has no such field, so there it is a no-op and the *prompt* has to ask for
     * JSON. Callers that rely on enforcement must keep the instruction in their
     * prompt, not in this flag.
     */
    json?: boolean;
}
