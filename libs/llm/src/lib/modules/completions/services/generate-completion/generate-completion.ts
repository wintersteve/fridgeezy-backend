import { resolveProvider } from "../../../provider";
import type { GenerateCompletionParams } from "../../types";

/**
 * One-shot completion from whichever provider is active, returning the visible
 * text — the non-streaming counterpart to `generateStream`, for the short
 * adjudicator calls that parse a single JSON object.
 *
 * Both clients are imported lazily on the branch that uses them, for the same
 * reason `generateStream` does it: `libs/openai` throws at *import* when
 * `OPENAI_API_KEY` is unset, so a static import would make an OpenAI key a hard
 * boot requirement for a function running entirely on Bedrock.
 *
 * Returns `""` rather than throwing when the model produces no text. Every call
 * site already treats empty output as "no verdict" and falls back to its own
 * default, so surfacing it as an exception would only move that decision into a
 * catch block.
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
            maxTokens: params.maxTokens?.bedrock,
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
        ...(params.maxTokens?.openai
            ? { max_completion_tokens: params.maxTokens.openai }
            : {}),
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
}
