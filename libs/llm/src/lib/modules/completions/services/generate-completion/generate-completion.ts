import { resolveProvider } from "../../../provider";
import { fromOpenAiUsage, reportUsage } from "../../../usage";
import type { CompletionResult, GenerateCompletionParams } from "../../types";

/**
 * One-shot completion from whichever provider is active — the non-streaming
 * counterpart to `generateStream`, used by the short adjudicator calls and by
 * ingredient extraction.
 *
 * Returns the stop reason alongside the text. That is not incidental: extraction
 * caps its output and reports a specific "try a clearer image" error when the
 * model is cut off, and truncation is only distinguishable from a model that
 * simply emitted bad JSON by this field. An earlier version returned a bare
 * string and lost it.
 *
 * `text` is `""` rather than an error when the model produces nothing. Every
 * call site already treats empty output as "no verdict" and falls back to its
 * own default, so surfacing it as an exception would only move that decision
 * into a catch block.
 *
 * Both clients are imported lazily on the branch that uses them: `libs/openai`
 * throws at *import* when `OPENAI_API_KEY` is unset, so a static import would
 * make an OpenAI key a hard boot requirement for a function running entirely on
 * Bedrock.
 */
export async function generateCompletion(
    params: GenerateCompletionParams
): Promise<CompletionResult> {
    const provider = resolveProvider(params.provider);
    const startedAt = Date.now();

    if (provider === "bedrock") {
        const { createCompletion } = await import("@fridgeezy/bedrock");

        return createCompletion({
            model: params.model.bedrock,
            system: params.system,
            user: params.user,
            image: params.image,
            maxTokens: params.maxTokens?.bedrock,
            thinking: params.thinking,
            effort: params.effort,
            onUsage: (usage) =>
                reportUsage({
                    provider,
                    model: params.model.bedrock ?? "(BEDROCK_MODEL_ID)",
                    label: params.label,
                    latencyMs: Date.now() - startedAt,
                    streamed: false,
                    ...usage,
                }),
        });
    }

    const { openai } = await import("@fridgeezy/openai");

    // OpenAI carries the image as one `image_url` part, with base64 encoded as a
    // data URI — where Anthropic names the media type in its own field. `detail`
    // is OpenAI-only and has no Anthropic counterpart.
    const userContent = params.image
        ? ([
              {
                  type: "image_url" as const,
                  image_url: {
                      url:
                          params.image.kind === "url"
                              ? params.image.data
                              : `data:${params.image.mimeType ?? "image/jpeg"};base64,${params.image.data.replace(/^data:[^;]+;base64,/, "")}`,
                      detail: "high" as const,
                  },
              },
              { type: "text" as const, text: params.user },
          ] as const)
        : params.user;

    const response = await openai.chat.completions.create({
        model: params.model.openai,
        messages: [
            ...(params.system
                ? [{ role: "system" as const, content: params.system }]
                : []),
            { role: "user" as const, content: userContent as never },
        ],
        ...(params.json
            ? { response_format: { type: "json_object" as const } }
            : {}),
        ...(params.maxTokens?.openai
            ? { max_completion_tokens: params.maxTokens.openai }
            : {}),
    });

    const choice = response.choices[0];

    reportUsage({
        provider,
        model: params.model.openai,
        label: params.label,
        latencyMs: Date.now() - startedAt,
        streamed: false,
        ...fromOpenAiUsage(response.usage),
    });

    return {
        text: choice?.message?.content?.trim() ?? "",
        finishReason: choice?.finish_reason ?? null,
    };
}
