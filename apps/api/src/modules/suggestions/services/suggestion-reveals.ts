import type { CompletionChunk } from "@fridgeezy/llm";

import { extractStableJsonFields } from "./extract-stable-json-fields";

/**
 * The incremental-reveal algorithm, split out from `stream-single-suggestion`
 * so it can be imported without the service graph behind it.
 *
 * ## Why it is its own file
 *
 * `streaming-conformance.check.ts` documents itself as "offline and
 * deterministic — no API keys, no network, no spend", which is what makes it
 * runnable while the account's Bedrock access is still gated. That was true of
 * what it *does* and false of what it could *load*: importing this one function
 * from `stream-single-suggestion` pulled in `persist-or-reuse-suggestion` and
 * through it `@fridgeezy/supabase`, which constructs its client at module scope
 * and throws on a missing key. The check died with `Missing SUPABASE_URL` before
 * running an assertion, so a safety net the notes describe as always available
 * could not in fact be run.
 *
 * Nothing here needs a client: it is string accumulation over an async iterable,
 * with `CompletionChunk` imported as a TYPE so even the provider seam is erased
 * at runtime. Keeping it separate is what holds that property — the check now
 * fails only if the algorithm is wrong, which is the only thing it should be
 * able to fail on.
 */
export interface PartialSuggestionFields {
    name?: string;
    nameEn?: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard";
    totalTimeMinutes?: number;
    ingredients?: string[];
    tags?: string[];
}

/**
 * Accumulate a streamed suggestion object, firing `onReveal` each time another
 * top-level key finishes — with every key stable so far, so a consumer renders
 * the latest state rather than diffing.
 *
 * Exported because the streaming-conformance check asserts this exact algorithm
 * holds across chunking regimes — monotonic, never revised, complete, in prompt
 * order. It used to keep a verbatim copy, which could drift silently from the
 * code it claimed to verify; it drives the real loop now that the stream is
 * provider-neutral rather than a live OpenAI client.
 *
 * Returns the raw accumulated buffer, since the caller still has to parse and
 * validate the completed object.
 */
export async function accumulateSuggestionReveals(
    stream: AsyncIterable<CompletionChunk>,
    onReveal?: (stable: Record<string, unknown>) => void
): Promise<string> {
    let buffer = "";
    // Which top-level keys we've already surfaced, so we only emit on new ones.
    let emittedKeys = 0;

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (!content) continue;

        buffer += content;

        const stable = extractStableJsonFields(buffer);
        const keyCount = Object.keys(stable).length;

        // A new field finished — surface everything known so far.
        if (keyCount > emittedKeys) {
            emittedKeys = keyCount;
            onReveal?.(stable);
        }
    }

    return buffer;
}
