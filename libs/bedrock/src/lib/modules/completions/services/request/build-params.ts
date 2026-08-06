import { bedrock, BEDROCK_MODEL } from "../../../client";
import type {
    BedrockCompletionParams,
    ThinkingEffort,
    ThinkingType,
} from "../../types";

/**
 * Bedrock requires an explicit output cap where the OpenAI path sets none.
 *
 * This is the cap for the **streaming** paths — it is what an unset `maxTokens`
 * falls back to, and every one-shot call site now names its own instead (see
 * `TokenLimit` in `@fridgeezy/llm`).
 *
 * Sized for the longest artefact — a full recipe JSONL — *plus* the thinking
 * that runs alongside it. Anthropic counts thinking and visible text against the
 * same `max_tokens`, so the previous 16k was a budget for the answer alone and
 * would have started truncating long recipes once thinking took its share.
 * Truncation here is silent: `processJsonlStream` drops a malformed line rather
 * than raising, so the recipe would simply arrive missing a section.
 */
export const BEDROCK_MAX_TOKENS = 32_000;

/**
 * Thinking configuration sent when a call site does not name one.
 *
 * **These are sent unconditionally, and that is the point.** Omitting `thinking`
 * does not mean "no thinking" — it means "whatever this model defaults to", and
 * the models disagree: Sonnet 4.6 runs without thinking when the field is
 * absent, Sonnet 5 runs adaptive. Leaving it unset made a `BEDROCK_MODEL_ID`
 * bump silently change both the bill (thinking bills as output) and the
 * truncation risk above, with nothing in this repo to flag it. Same for
 * `effort`: unset is not cheap, it is the API's `high`.
 *
 * Adaptive at medium effort is the repo's documented position — see the caveat
 * on {@link ThinkingType} for why disabling it on a streaming path is not the
 * cost lever it looks like — and it is what the Phase 0 eval's leading candidate
 * (`sonnet-4.6 / adaptive-med`) is measured at, so the default and the run that
 * justifies it stay the same configuration.
 *
 * **There is deliberately no "send neither field" state.** Two models on the
 * eval roster reject this pair outright — Haiku 4.5 and Sonnet 4.5 take the
 * older `budget_tokens` form and error on `effort` — so pointing
 * `BEDROCK_MODEL_ID` at either is a change that has to come through this file
 * rather than one that silently half-works.
 */
export const DEFAULT_THINKING: ThinkingType = "adaptive";
export const DEFAULT_EFFORT: ThinkingEffort = "medium";

/**
 * Build the request body shared by the streaming and one-shot calls.
 *
 * `thinking`/`output_config` are newer than the installed SDK's types, so the
 * cast sits here at the parameter boundary — the wire fields are correct —
 * rather than on the response, where it would mask real shape errors.
 */
export const buildParams = (params: BedrockCompletionParams) => ({
    model: params.model ?? BEDROCK_MODEL,
    max_tokens: params.maxTokens ?? BEDROCK_MAX_TOKENS,
    ...(params.system ? { system: params.system } : {}),
    messages: [{ role: "user" as const, content: params.user }],
    thinking: { type: params.thinking ?? DEFAULT_THINKING },
    output_config: { effort: params.effort ?? DEFAULT_EFFORT },
});

export type MessagesCreateParams = Parameters<typeof bedrock.messages.create>[0];
