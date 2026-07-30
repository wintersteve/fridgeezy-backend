export type LlmProvider = "openai" | "bedrock";

/** Env var selecting the inference provider for every call site at once. */
export const LLM_PROVIDER_ENV = "LLM_PROVIDER";

/**
 * Which provider a call runs against.
 *
 * Defaults to **openai** so production keeps its current behavior: the plan's
 * gate is that Bedrock must match or beat the OpenAI baseline on the eval set
 * before it carries traffic, and a default of `bedrock` would flip every call
 * site the moment this lands.
 *
 * An unrecognised value throws rather than falling back — a typo in the env of a
 * deployed function would otherwise silently keep serving OpenAI while looking
 * like it had been switched over.
 */
export const resolveProvider = (override?: LlmProvider): LlmProvider => {
    const value = override ?? process.env[LLM_PROVIDER_ENV];

    if (!value || value === "openai") return "openai";
    if (value === "bedrock") return "bedrock";

    throw new Error(
        `Unknown ${LLM_PROVIDER_ENV} "${value}" — expected "openai" or "bedrock"`
    );
};
