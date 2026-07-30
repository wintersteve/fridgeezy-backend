import { resolveProvider } from "../../../provider";
import type { GenerateCompletionParams } from "../../types";

/**
 * One-shot (non-streaming) completion from the active provider, returning the
 * text. For the adjudicators and other call sites that read
 * `choices[0].message.content` today.
 *
 * Clients are imported lazily for the reason given on `generateStream`.
 */
export async function generateCompletion(
    params: GenerateCompletionParams
): Promise<string> {
    if (resolveProvider(params.provider) === "bedrock") {
        const { createCompletion } = await import("@fridgeezy/bedrock");

        return createCompletion({
            model: params.model.bedrock,
            system: params.system,
            user: params.user,
            maxTokens: params.maxTokens,
            thinking: params.thinking,
            effort: params.effort,
        });
    }

    const { openai } = await import("@fridgeezy/openai");

    const response = await openai.chat.completions.create({
        model: params.model.openai,
        messages: [
            ...(params.system
                ? [{ role: "system" as const, content: params.system }]
                : []),
            { role: "user" as const, content: params.user },
        ],
        ...(params.json
            ? { response_format: { type: "json_object" as const } }
            : {}),
        ...(params.maxTokens
            ? { max_completion_tokens: params.maxTokens }
            : {}),
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
}
