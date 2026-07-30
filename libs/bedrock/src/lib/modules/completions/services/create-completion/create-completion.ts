import { bedrock, BEDROCK_MODEL } from "../../../client";
import type { BedrockCompletionParams } from "../../types";
import { BEDROCK_MAX_TOKENS } from "../stream-completion";

interface AnthropicTextBlock {
    type: string;
    text?: string;
}

/**
 * One-shot (non-streaming) completion, returning the concatenated text.
 *
 * For the call sites that don't stream — the adjudicators and the vision path —
 * which read `choices[0].message.content` off OpenAI today. Thinking blocks are
 * filtered out, so the return value is only what the model meant to say.
 */
export async function createCompletion(
    params: BedrockCompletionParams
): Promise<string> {
    const response = await bedrock.messages.create({
        model: params.model ?? BEDROCK_MODEL,
        max_tokens: params.maxTokens ?? BEDROCK_MAX_TOKENS,
        ...(params.system ? { system: params.system } : {}),
        messages: [{ role: "user" as const, content: params.user }],
        ...(params.thinking ? { thinking: { type: params.thinking } } : {}),
        ...(params.effort ? { output_config: { effort: params.effort } } : {}),
    } as unknown as Parameters<typeof bedrock.messages.create>[0]);

    const content = (response as { content?: AnthropicTextBlock[] }).content;

    return (content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
}
