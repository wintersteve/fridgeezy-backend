import {
    AnthropicChatEvent,
    AnthropicStreamEvent,
    ChatStreamEvent,
    toAnthropicMessages,
    toAnthropicImageBlock,
    toChatStreamEvents,
    toCompletionChunks,
    toFinishReason,
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

import { accumulateSuggestionReveals } from "../../modules/suggestions/services/stream-single-suggestion";

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
 *
 * **It tests the BUILT libs, not their source.** It runs under `jiti`, which
 * resolves `@fridgeezy/bedrock` through package exports to `dist/` rather than
 * through the `@fridgeezy/source` condition tsc uses. That is the right thing to
 * verify — it is what ships — but it means editing a translator and re-running
 * this check without rebuilding silently grades the *previous* build. If a
 * change you expect to break something leaves the count untouched, rebuild the
 * lib before believing it.
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

/**
 * Anthropic usage as it really arrives: split across two event types, with the
 * output count RESTATED as a running total on every `message_delta` rather than
 * sent as an increment.
 *
 * That restatement is the whole reason this fixture exists. An accumulator that
 * sums `message_delta` — the obvious implementation — multiplies the output
 * count, and the resulting cost comparison is wrong in the direction that makes
 * Bedrock look worse than it is. Nothing downstream would flag it: the numbers
 * are plausible, just inflated.
 */
function anthropicUsageEvents(): AsyncIterable<AnthropicStreamEvent> {
    const events: AnthropicStreamEvent[] = [
        {
            type: "message_start",
            message: {
                usage: {
                    input_tokens: 120,
                    cache_read_input_tokens: 3712,
                    output_tokens: 0,
                },
            },
        },
        { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
        { type: "message_delta", usage: { output_tokens: 7 } },
        { type: "message_delta", usage: { output_tokens: 41 } },
        { type: "message_stop" },
    ];

    return (async function* () {
        for (const event of events) yield event;
    })();
}

/**
 * Usage is observed, reported exactly once, and never reaches the chunk stream.
 *
 * Unexercised against a live model like the rest of the Bedrock path, and worth
 * covering for the same reason: the failure is silent. Usage that comes back as
 * zeros does not error — it produces a cost comparison built on nothing, which is
 * the one thing this instrumentation exists to prevent.
 */
async function checkUsageReporting(): Promise<void> {
    console.log("\nUsage accounting — observed, not streamed:");

    const reported: { inputTokens: number; cachedInputTokens: number; outputTokens: number }[] = [];
    const text: string[] = [];

    for await (const chunk of toCompletionChunks(anthropicUsageEvents(), (usage) =>
        reported.push(usage)
    )) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) text.push(content);
    }

    check(`${"fires once".padEnd(17)} one record per stream`, reported.length === 1, `got ${reported.length}`);
    check(
        `${"input".padEnd(17)} read from message_start`,
        reported[0]?.inputTokens === 120,
        `got ${reported[0]?.inputTokens}`
    );
    check(
        `${"cache".padEnd(17)} read + creation summed`,
        reported[0]?.cachedInputTokens === 3712,
        `got ${reported[0]?.cachedInputTokens}`
    );
    check(
        `${"output".padEnd(17)} last total wins, not summed`,
        reported[0]?.outputTokens === 41,
        `got ${reported[0]?.outputTokens} (48 means the deltas were added up)`
    );
    check(
        `${"isolation".padEnd(17)} no usage event became text`,
        text.join("") === "hi",
        `got ${JSON.stringify(text.join(""))}`
    );
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
 * Drives the *production* reveal loop, not a copy of it.
 *
 * This used to replay `stream-single-suggestion.ts`'s algorithm verbatim,
 * because that function was welded to a live OpenAI client and could not be
 * handed a stream. Now that it takes a provider-neutral one, the check calls the
 * real `accumulateSuggestionReveals` — so the algorithm asserted here cannot
 * drift from the algorithm that ships.
 */
async function collectReveals(
    stream: AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }>
): Promise<Record<string, unknown>[]> {
    const reveals: Record<string, unknown>[] = [];

    await accumulateSuggestionReveals(stream, (stable) => reveals.push(stable));

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


// --------------------------------------------------------------------------
// Tool calling — the part of the chat port with no JSONL to fall back on.
// --------------------------------------------------------------------------

/**
 * The arguments a tool call carries. Deliberately awkward: nested braces, a
 * string containing a `}`, and a unicode escape — because the Anthropic side
 * rebuilds this from `input_json_delta` fragments, and a naive reassembly that
 * splits on braces or mangles escapes produces JSON that still *parses* but
 * means something else.
 */
const TOOL_ARGS =
    '{"query":"sauce for apple strudel","exclude":["apple strudel"],"note":"say }} if unsure","unicode":"cr\\u00e8me"}';

/** Wrap tool-call fragments in the Anthropic content-block envelope. */
function anthropicToolEvents(
    argChunks: string[],
    options: { text?: string; second?: boolean } = {}
): AsyncIterable<AnthropicChatEvent> {
    const events: AnthropicChatEvent[] = [{ type: "message_start" }];

    // Thinking first, as it arrives on any adaptive-thinking request. It must
    // never reach the user, and must never be mistaken for tool input.
    events.push(
        { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
        {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", text: "<thinking>which tool</thinking>" },
        },
        { type: "content_block_stop", index: 0 }
    );

    if (options.text) {
        events.push(
            { type: "content_block_start", index: 1, content_block: { type: "text" } },
            {
                type: "content_block_delta",
                index: 1,
                delta: { type: "text_delta", text: options.text },
            },
            { type: "content_block_stop", index: 1 }
        );
    }

    events.push({
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "toolu_01", name: "GET_RECIPE_SUGGESTIONS" },
    });
    for (const chunk of argChunks) {
        events.push({
            type: "content_block_delta",
            index: 2,
            delta: { type: "input_json_delta", partial_json: chunk },
        });
    }
    events.push({ type: "content_block_stop", index: 2 });

    if (options.second) {
        // A second tool call, opened at a HIGHER block index. Ordering by index
        // is what keeps tool results aligned with what the model asked for.
        events.push(
            {
                type: "content_block_start",
                index: 3,
                content_block: { type: "tool_use", id: "toolu_02", name: "SECOND_TOOL" },
            },
            {
                type: "content_block_delta",
                index: 3,
                delta: { type: "input_json_delta", partial_json: '{"a":1}' },
            },
            { type: "content_block_stop", index: 3 }
        );
    }

    events.push(
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" }
    );

    return (async function* () {
        for (const event of events) yield event;
    })();
}

async function collectChatEvents(
    events: AsyncIterable<AnthropicChatEvent>
): Promise<ChatStreamEvent[]> {
    const out: ChatStreamEvent[] = [];

    for await (const event of toChatStreamEvents(events)) out.push(event);

    return out;
}

async function checkToolCallStreaming(): Promise<void> {
    console.log("\nTool calling — argument reassembly across chunk boundaries:");

    for (const [regime, split] of Object.entries(REGIMES)) {
        const events = await collectChatEvents(
            anthropicToolEvents(split(TOOL_ARGS), { text: "Let me look." })
        );

        const toolEvent = events.find((e) => e.type === "tool_calls");
        const call =
            toolEvent?.type === "tool_calls" ? toolEvent.tool_calls[0] : undefined;

        // The arguments must survive fragmentation byte-for-byte: the handler
        // layer JSON.parses this string, and a corrupted one is caught and
        // turned into a default verdict rather than an error.
        const exact = call?.function.arguments === TOOL_ARGS;
        const parses = (() => {
            try {
                return (
                    JSON.parse(call?.function.arguments ?? "").query ===
                    "sauce for apple strudel"
                );
            } catch {
                return false;
            }
        })();

        const named =
            call?.function.name === "GET_RECIPE_SUGGESTIONS" && call?.id === "toolu_01";

        // Thinking must not surface as visible text, and must not be swallowed
        // into the tool arguments either.
        const chunks = events
            .filter((e) => e.type === "chunk")
            .map((e) => (e.type === "chunk" ? e.delta : ""))
            .join("");
        const clean = !chunks.includes("<thinking>") && chunks === "Let me look.";

        const done = events[events.length - 1];
        const finished =
            done?.type === "done" && done.finish_reason === "tool_calls";

        check(
            `${regime.padEnd(17)} ${split(TOOL_ARGS).length.toString().padStart(3)} frag -> args ${exact ? "exact" : "CORRUPT"}`,
            exact && parses && named && clean && finished,
            [
                exact ? "" : "arguments differ from source",
                parses ? "" : "arguments do not parse",
                named ? "" : "id/name lost",
                clean ? "" : "thinking leaked into visible text",
                finished ? "" : "stop_reason not mapped to tool_calls",
            ]
                .filter(Boolean)
                .join("; ")
        );
    }

    // Two calls in one turn, emitted in block order.
    const two = await collectChatEvents(
        anthropicToolEvents([TOOL_ARGS], { second: true })
    );
    const twoEvent = two.find((e) => e.type === "tool_calls");
    const ids =
        twoEvent?.type === "tool_calls"
            ? twoEvent.tool_calls.map((c) => c.id)
            : [];

    check(
        `${"two calls".padEnd(17)} ordered by content-block index`,
        ids.join(",") === "toolu_01,toolu_02",
        `got ${ids.join(",") || "none"}`
    );

    // A turn with no tool call must not fabricate an empty tool_calls event —
    // process-chat treats its presence as "run the tools".
    const plain = await collectChatEvents(
        (async function* () {
            yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
            yield {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Just chatting." },
            };
            yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
        })()
    );

    check(
        `${"no tools".padEnd(17)} emits no tool_calls event`,
        !plain.some((e) => e.type === "tool_calls") &&
            plain[plain.length - 1]?.type === "done",
        "an empty tool_calls event would make process-chat run the tool loop"
    );
}

function checkFinishReasonMapping(): void {
    console.log("\nTool calling — stop_reason mapped to the OpenAI vocabulary:");

    // process-chat branches on `finish_reason === "tool_calls"`, so a wrong
    // mapping here disables tool calling silently rather than erroring.
    const cases: [string, string | null][] = [
        ["tool_use", "tool_calls"],
        ["end_turn", "stop"],
        ["stop_sequence", "stop"],
        ["max_tokens", "length"],
    ];

    for (const [anthropic, expected] of cases) {
        const actual = toFinishReason(anthropic);

        check(
            `${anthropic.padEnd(17)} -> ${expected}`,
            actual === expected,
            `got ${actual}`
        );
    }
}

function checkMessageTranslation(): void {
    console.log("\nTool calling — conversation reshaped for Anthropic:");

    const { system, messages } = toAnthropicMessages([
        { role: "system", content: "You are a recipe assistant." },
        { role: "user", content: "what sauce goes with apple strudel?" },
        {
            role: "assistant",
            content: "Let me look.",
            tool_calls: [
                {
                    id: "toolu_01",
                    type: "function",
                    function: { name: "GET_RECIPE_SUGGESTIONS", arguments: '{"query":"x"}' },
                },
                {
                    id: "toolu_02",
                    type: "function",
                    function: { name: "SECOND_TOOL", arguments: "not json" },
                },
            ],
        },
        { role: "tool", tool_call_id: "toolu_01", content: '{"suggestions":[]}' },
        { role: "tool", tool_call_id: "toolu_02", content: "{}" },
        { role: "system", content: "Now summarise." },
    ]);

    check(
        `${"system".padEnd(17)} lifted out and joined`,
        system === "You are a recipe assistant.\n\nNow summarise." &&
            !messages.some((m) => (m.role as string) === "system"),
        "Anthropic takes system as a top-level field, and this app sends two"
    );

    const assistant = messages[1];
    const blocks = Array.isArray(assistant?.content) ? assistant.content : [];
    const toolUse = blocks.filter((b) => b.type === "tool_use");

    check(
        `${"tool_calls".padEnd(17)} become tool_use blocks with parsed input`,
        toolUse.length === 2 &&
            toolUse[0].type === "tool_use" &&
            JSON.stringify(toolUse[0].input) === '{"query":"x"}',
        "Anthropic wants `input` as an object where OpenAI carries a JSON string"
    );

    check(
        `${"bad arguments".padEnd(17)} degrade to {} rather than throwing`,
        toolUse[1]?.type === "tool_use" &&
            JSON.stringify(toolUse[1].input) === "{}",
        "a throw here would abort a conversation mid-turn"
    );

    // The merge is not cosmetic: Anthropic rejects one assistant turn with two
    // tool_use blocks answered by two separate user messages.
    const results = messages.filter(
        (m) =>
            m.role === "user" &&
            Array.isArray(m.content) &&
            m.content.some((b) => b.type === "tool_result")
    );
    const merged =
        results.length === 1 &&
        Array.isArray(results[0].content) &&
        results[0].content.length === 2;

    check(
        `${"tool results".padEnd(17)} merged into ONE user turn`,
        merged,
        `got ${results.length} user turn(s) carrying tool_result`
    );

    // OpenAI tolerates empty-string content; Anthropic rejects it.
    const { messages: sparse } = toAnthropicMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: "" },
        { role: "user", content: null },
    ]);

    check(
        `${"empty content".padEnd(17)} dropped, not sent as ""`,
        sparse.length === 1,
        `got ${sparse.length} message(s)`
    );
}


function checkImageTranslation(): void {
    console.log("\nVision — image wrapped the way Anthropic expects:");

    // OpenAI infers the media type from the data URI; Anthropic needs it named
    // separately, so a base64 payload has to be split from its prefix.
    const bare = toAnthropicImageBlock({
        kind: "base64",
        data: "AAAB",
        mimeType: "image/png",
    });

    check(
        `${"base64".padEnd(17)} media_type named separately`,
        bare.type === "image" &&
            bare.source.type === "base64" &&
            "media_type" in bare.source &&
            bare.source.media_type === "image/png" &&
            "data" in bare.source &&
            bare.source.data === "AAAB",
        JSON.stringify(bare)
    );

    // Callers reasonably hold the payload either way. Sending the prefix inside
    // the base64 field fails server-side with an opaque error, so it is stripped
    // rather than trusted.
    const prefixed = toAnthropicImageBlock({
        kind: "base64",
        data: "data:image/jpeg;base64,AAAB",
        mimeType: "image/jpeg",
    });

    check(
        `${"data: prefix".padEnd(17)} stripped from the payload`,
        "data" in prefixed.source && prefixed.source.data === "AAAB",
        JSON.stringify(prefixed)
    );

    const url = toAnthropicImageBlock({ kind: "url", data: "https://x/y.jpg" });

    check(
        `${"url".padEnd(17)} passed through as a url source`,
        url.source.type === "url" &&
            "url" in url.source &&
            url.source.url === "https://x/y.jpg",
        JSON.stringify(url)
    );

    const defaulted = toAnthropicImageBlock({ kind: "base64", data: "AAAB" });

    check(
        `${"no mimeType".padEnd(17)} defaults to image/jpeg`,
        "media_type" in defaulted.source &&
            defaulted.source.media_type === "image/jpeg",
        "Anthropic rejects a base64 source with no media_type"
    );
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
    await checkUsageReporting();
    await checkToolCallStreaming();
    checkFinishReasonMapping();
    checkMessageTranslation();
    checkImageTranslation();

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
