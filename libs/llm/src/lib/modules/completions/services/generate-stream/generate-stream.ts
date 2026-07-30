import { resolveProvider } from "../../../provider";
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
 */
export async function* generateStream(
    params: GenerateStreamParams
): AsyncGenerator<CompletionChunk> {
    if (resolveProvider(params.provider) === "bedrock") {
        const { streamCompletion } = await import("@fridgeezy/bedrock");

        yield* streamCompletion({
            model: params.model.bedrock,
            system: params.system,
            user: params.user,
            maxTokens: params.maxTokens,
            thinking: params.thinking,
            effort: params.effort,
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
    });

    for await (const chunk of stream) {
        yield chunk;
    }
}
