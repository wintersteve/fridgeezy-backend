import { bedrock, BEDROCK_MODEL } from "../../../client";
import type { BedrockCompletionParams } from "../../types";

/**
 * Bedrock requires an explicit output cap where the OpenAI path sets none.
 * Sized for the longest artefact (a full recipe JSONL), not for the average.
 */
export const BEDROCK_MAX_TOKENS = 16_000;

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
    ...(params.thinking ? { thinking: { type: params.thinking } } : {}),
    ...(params.effort ? { output_config: { effort: params.effort } } : {}),
});

export type MessagesCreateParams = Parameters<typeof bedrock.messages.create>[0];
