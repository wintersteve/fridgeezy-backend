import { resolveProvider } from "../../../provider";
import { fromOpenAiUsage, reportUsage } from "../../../usage";
import type { CompletionChunk, GenerateStreamParams } from "../../types";

/**
 * Stream a completion from whichever provider is active, as OpenAI-shaped
 * chunks — so the result goes straight into `processJsonlStream` and a call site
 * never names an SDK.
 *
 * The OpenAI branch mirrors the production call exactly: no `max_tokens`, no
 * sampling overrides. Switching provider is then the only variable between the
 * two, which is what makes the eval comparison meaningful.
 *
 * Both clients are imported lazily, on the branch that uses them. `libs/openai`
 * throws at import when `OPENAI_API_KEY` is unset, so a static import would make
 * an OpenAI key a hard boot requirement for a function running entirely on
 * Bedrock — exactly what this abstraction exists to avoid.
 *
 * Both branches report token usage through `reportUsage` on the way out. Doing
 * it here rather than at the eleven call sites is what makes the two providers
 * comparable at all: the counts are normalised to one shape and one log line
 * regardless of which SDK produced them, and a new call site is instrumented by
 * construction rather than by remembering.
 */
export async function* generateStream(
    params: GenerateStreamParams
): AsyncGenerator<CompletionChunk> {
    const provider = resolveProvider(params.provider);
    const startedAt = Date.now();

    if (provider === "bedrock") {
        const { streamCompletion } = await import("@fridgeezy/bedrock");

        yield* streamCompletion({
            model: params.model.bedrock,
            system: params.system,
            user: params.user,
            maxTokens: params.maxTokens,
            thinking: params.thinking,
            effort: params.effort,
            onUsage: (usage) =>
                reportUsage({
                    provider,
                    model: params.model.bedrock ?? "(BEDROCK_MODEL_ID)",
                    label: params.label,
                    latencyMs: Date.now() - startedAt,
                    streamed: true,
                    ...usage,
                }),
        });

        return;
    }

    const { openai } = await import("@fridgeezy/openai");

    const stream = await openai.chat.completions.create({
        model: params.model.openai,
        messages: [
            ...(params.system
                ? [{ role: "system" as const, content: params.system }]
                : []),
            { role: "user" as const, content: params.user },
        ],
        stream: true,
        // Without this OpenAI reports no usage at all on a streamed response.
        // It arrives as a final chunk carrying `usage` and an EMPTY `choices`
        // array — which `processJsonlStream` already tolerates, since it reads
        // `choices[0]?.delta?.content` and skips falsy content. Verified against
        // that guard rather than assumed.
        stream_options: { include_usage: true },
    });

    let usage: ReturnType<typeof fromOpenAiUsage> | undefined;

    for await (const chunk of stream) {
        if (chunk.usage) usage = fromOpenAiUsage(chunk.usage);
        yield chunk;
    }

    reportUsage({
        provider,
        model: params.model.openai,
        label: params.label,
        latencyMs: Date.now() - startedAt,
        streamed: true,
        inputTokens: usage?.inputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
    });
}
