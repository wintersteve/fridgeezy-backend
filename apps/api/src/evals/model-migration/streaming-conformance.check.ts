import {
    AnthropicStreamEvent,
    toCompletionChunks,
} from "@fridgeezy/bedrock";
import {
    GenerateSuggestionResponseSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";

import { extractStableJsonFields } from "../../modules/suggestions/services/extract-stable-json-fields";

/**
 * Phase 1 — "port the streaming shape" conformance check.
 *
 * Verifies that a Bedrock/Anthropic event stream drives the existing JSONL
 * plumbing exactly as an OpenAI stream does, including the incremental field
 * reveal `streamSingleSuggestion` depends on.
 *
 * **Offline and deterministic** — no API keys, no network, no spend. It replays
 * recorded-shape Anthropic events rather than calling a model, which is what
 * makes it runnable while the account's Bedrock access is still gated. It
 * therefore proves the *adapter and parser* are correct; it says nothing about
 * whether a given model produces good content (that is the eval harness's job).
 *
 * The failure it exists to catch is silent: `processJsonlStream` skips a
 * malformed line rather than raising, so a chunk-boundary regression shows up as
 * missing suggestions, not as an error.
 *
 *   npx nx run @fridgeezy/api:check-streaming-conformance
 */

// --------------------------------------------------------------------------
// Payloads — realistic model output, byte-for-byte what the prompts ask for.
// --------------------------------------------------------------------------

/**
 * Single-suggestion object. Key order matters: it mirrors the visible-first
 * order `stream-single-suggestion.ts` pins in its prompt, because that order is
 * what makes progressive reveal useful (title first, persistence-only last).
 */
const SINGLE_SUGGESTION =
    '{"name":"Carbonara","description":"Roman pasta with egg, pecorino and guanciale","difficulty":"medium","ingredients":["spaghetti","egg","pecorino","guanciale","black pepper"],"tags":["dish","italian","main"],"name_alt":"Spaghetti alla Carbonara"}';

/**
 * Four-line JSONL, as the batch suggestions prompt demands. Three of the four
 * carry a null `name_alt` — the common case, where a dish
 * known by only one name must NOT echo it — so the parser is exercised on the
 * null branch as well as the populated one.
 */
const SUGGESTIONS_JSONL = [
    '{"name":"Carbonara","name_alt":"Spaghetti alla Carbonara","description":"Roman pasta with egg and guanciale","difficulty":"medium","ingredients":["spaghetti","egg","pecorino","guanciale"],"tags":["dish","italian","main"]}',
    '{"name":"Cacio e Pepe","name_alt":null,"description":"Pecorino and black pepper pasta","difficulty":"easy","ingredients":["spaghetti","pecorino","black pepper"],"tags":["dish","italian","main"]}',
    '{"name":"Amatriciana","name_alt":null,"description":"Tomato, guanciale and pecorino pasta","difficulty":"easy","ingredients":["bucatini","tomato","guanciale","pecorino"],"tags":["dish","italian","main"]}',
    '{"name":"Gricia","name_alt":null,"description":"Guanciale and pecorino pasta, no tomato","difficulty":"medium","ingredients":["rigatoni","guanciale","pecorino","black pepper"],"tags":["dish","italian","main"]}',
].join("\n");

/** Recipe JSONL — mixed line types, and numbers, which are the fragile case. */
const RECIPE_JSONL = [
    '{"type":"header","name":"Spaghetti alla Carbonara","description":"A Roman classic.","difficulty":"medium","servings":4,"prepTime":10,"cookTime":15,"tags":["dish","italian","main"]}',
    '{"type":"nutrition","kcal":650,"carbs":72,"protein":28,"fat":26}',
    '{"type":"ingredient","name":"spaghetti","category":"grain","quantity":400,"unit":"g"}',
    '{"type":"ingredient","name":"guanciale","category":"meat","quantity":150,"unit":"g","comment":"diced"}',
    '{"type":"instruction","text":"Render the guanciale until crisp.","ingredients":["guanciale"]}',
    '{"type":"tip","text":"Take the pan off the heat before adding the egg."}',
].join("\n");

// --------------------------------------------------------------------------
// Chunking regimes — the actual variable under test.
// --------------------------------------------------------------------------

/**
 * Providers split text differently, and every downstream assumption about
 * "a chunk" is really an assumption about these boundaries. Anthropic emits
 * noticeably coarser deltas than OpenAI, so the two extremes plus a
 * one-character worst case bracket anything a real provider will do.
 */
const REGIMES: Record<string, (text: string) => string[]> = {
    /** ~1 char — worst case for any parser that assumes token-sized chunks. */
    pathological: (text) => [...text],

    /** ~4 chars, roughly OpenAI token granularity. */
    "openai-fine": (text) => text.match(/[\s\S]{1,4}/g) ?? [],

    /** ~120 chars, roughly Anthropic delta granularity. */
    "anthropic-coarse": (text) => text.match(/[\s\S]{1,120}/g) ?? [],

    /** Whole payload in one delta — the degenerate large-chunk case. */
    single: (text) => [text],

    /**
     * Splits exactly on the newline boundary, so a chunk ends where a JSONL
     * record does. Worth isolating because it is the boundary `processJsonlStream`
     * keys on, and an off-by-one there loses a whole record.
     */
    "line-aligned": (text) =>
        text.split("\n").flatMap((line, index, all) =>
            index < all.length - 1 ? [line, "\n"] : [line]
        ),
};

/** Wrap text chunks in the Anthropic event envelope, thinking deltas included. */
function anthropicEvents(chunks: string[]): AsyncIterable<AnthropicStreamEvent> {
    const events: AnthropicStreamEvent[] = [
        { type: "message_start" },
        // A thinking block precedes the answer on any adaptive-thinking request.
        // If its deltas ever reach the parser they corrupt the first JSONL line,
        // so they are interleaved here rather than merely prepended.
        { type: "content_block_start" },
        { type: "content_block_delta", delta: { type: "thinking_delta", text: "<thinking>weighing options" } },
        { type: "content_block_delta", delta: { type: "thinking_delta", text: "</thinking>" } },
        { type: "content_block_stop" },
        { type: "content_block_start" },
    ];

    chunks.forEach((text, index) => {
        events.push({ type: "content_block_delta", delta: { type: "text_delta", text } });
        // A stray thinking delta mid-answer: the interleaving adaptive thinking
        // actually produces, and the case a prepend-only fixture would miss.
        if (index === Math.floor(chunks.length / 2)) {
            events.push({
                type: "content_block_delta",
                delta: { type: "thinking_delta", text: "<thinking>reconsidering</thinking>" },
            });
        }
    });

    events.push(
        { type: "content_block_stop" },
        { type: "message_delta" },
        { type: "message_stop" }
    );

    return (async function* () {
        for (const event of events) yield event;
    })();
}

/** The OpenAI baseline: chunks already in the shape the parser expects. */
function openAiChunks(chunks: string[]) {
    return (async function* () {
        for (const content of chunks) yield { choices: [{ delta: { content } }] };
    })();
}

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
    if (ok) passed++;
    else failed++;
}

async function collectJsonl(
    stream: AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }>,
    schemas: Parameters<typeof processJsonlStream>[1]
): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const { parsed } of processJsonlStream(stream, schemas)) {
        out.push(parsed);
    }
    return out;
}

/**
 * Replays `stream-single-suggestion.ts`'s reveal loop verbatim. Duplicated
 * rather than imported because that function is welded to a live OpenAI client
 * (`client.chat.completions.create`) and cannot be handed a stream — porting it
 * is the *next* checkbox. If its algorithm changes, this must change with it.
 */
async function collectReveals(
    stream: AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }>
): Promise<Record<string, unknown>[]> {
    const reveals: Record<string, unknown>[] = [];
    let buffer = "";
    let emittedKeys = 0;

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (!content) continue;
        buffer += content;

        const stable = extractStableJsonFields(buffer);
        const keyCount = Object.keys(stable).length;
        if (keyCount > emittedKeys) {
            emittedKeys = keyCount;
            reveals.push(stable);
        }
    }

    return reveals;
}

async function checkJsonlParity(
    label: string,
    payload: string,
    schemas: Parameters<typeof processJsonlStream>[1],
    expectedCount: number
): Promise<void> {
    console.log(`\n${label} — JSONL parity (Bedrock events vs OpenAI chunks):`);

    const baseline = JSON.stringify(
        await collectJsonl(openAiChunks(REGIMES["openai-fine"](payload)), schemas)
    );

    for (const [regime, split] of Object.entries(REGIMES)) {
        const chunks = split(payload);
        const viaBedrock = await collectJsonl(
            toCompletionChunks(anthropicEvents(chunks)),
            schemas
        );
        const parsedCount = viaBedrock.length;
        const matches = JSON.stringify(viaBedrock) === baseline;

        check(
            `${regime.padEnd(17)} ${String(chunks.length).padStart(5)} deltas -> ${parsedCount}/${expectedCount} records`,
            matches && parsedCount === expectedCount,
            matches ? `expected ${expectedCount}, got ${parsedCount}` : "output differs from OpenAI baseline"
        );
    }
}

async function checkIncrementalReveal(): Promise<void> {
    console.log("\nSingle suggestion — incremental field reveal:");

    const finalFields = JSON.parse(SINGLE_SUGGESTION) as Record<string, unknown>;
    const expectedOrder = Object.keys(finalFields);

    for (const [regime, split] of Object.entries(REGIMES)) {
        const reveals = await collectReveals(
            toCompletionChunks(anthropicEvents(split(SINGLE_SUGGESTION)))
        );

        if (reveals.length === 0) {
            check(`${regime.padEnd(17)} revealed nothing`, false);
            continue;
        }

        const last = reveals[reveals.length - 1];

        // 1. Monotonic: a field, once revealed, is never withdrawn.
        const monotonic = reveals.every((snapshot, index) => {
            if (index === 0) return true;
            return Object.keys(reveals[index - 1]).every((key) => key in snapshot);
        });

        // 2. Stable: a revealed value NEVER changes afterwards. This is the whole
        //    contract — the card renders each field the instant it appears, so a
        //    value that is later corrected would have been shown wrong.
        const stable = reveals.every((snapshot) =>
            Object.entries(snapshot).every(
                (entry) =>
                    JSON.stringify(entry[1]) === JSON.stringify(finalFields[entry[0]])
            )
        );

        // 3. Complete and in prompt order by the end.
        const complete =
            JSON.stringify(Object.keys(last)) === JSON.stringify(expectedOrder);

        // 4. Actually progressive — a single end-of-stream reveal would satisfy
        //    every check above while defeating the point. The degenerate
        //    one-delta regimes cannot be progressive, so they are exempt.
        const oneDelta = split(SINGLE_SUGGESTION).length === 1;
        const progressive = oneDelta || reveals.length > 1;

        const problems = [
            monotonic ? "" : "field withdrawn",
            stable ? "" : "revealed value later changed",
            complete ? "" : `final keys ${JSON.stringify(Object.keys(last))}`,
            progressive ? "" : "all fields landed in one frame",
        ].filter(Boolean);

        check(
            `${regime.padEnd(17)} ${String(reveals.length).padStart(2)} reveal(s), order ${complete ? "ok" : "wrong"}`,
            problems.length === 0,
            problems.join("; ")
        );
    }
}

async function checkThinkingFiltered(): Promise<void> {
    console.log("\nThinking deltas must never reach the visible text:");

    for (const [regime, split] of Object.entries(REGIMES)) {
        let text = "";
        for await (const chunk of toCompletionChunks(
            anthropicEvents(split(SINGLE_SUGGESTION))
        )) {
            text += chunk.choices[0]?.delta?.content ?? "";
        }

        check(
            `${regime.padEnd(17)} no <thinking> in ${text.length} chars`,
            !text.includes("<thinking>") && text === SINGLE_SUGGESTION,
            text.includes("<thinking>")
                ? "thinking leaked into visible text"
                : "reassembled text differs from the source payload"
        );
    }
}

async function main() {
    console.log(
        "Phase 1 streaming-shape conformance — offline, deterministic, no spend\n" +
            "=".repeat(72)
    );

    await checkThinkingFiltered();
    await checkJsonlParity(
        "Suggestions",
        SUGGESTIONS_JSONL,
        [GenerateSuggestionResponseSchema],
        4
    );
    await checkJsonlParity(
        "Recipe",
        RECIPE_JSONL,
        [HeaderSchema, NutritionSchema, IngredientSchema, InstructionSchema, TipSchema],
        6
    );
    await checkIncrementalReveal();

    console.log("\n" + "=".repeat(72));
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\nConformance check failed to run:", error);
        process.exit(1);
    });
