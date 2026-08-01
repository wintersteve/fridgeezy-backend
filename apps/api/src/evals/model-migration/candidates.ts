import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { openai } from "@fridgeezy/openai";

/**
 * Provider seam for the Phase 0 eval harness.
 *
 * This deliberately lives under `evals/` rather than in `libs/`: Phase 1 owns the
 * production provider abstraction, and pre-building it here would mean shipping
 * an interface before the evals that justify it. What this seam does establish is
 * the shape Phase 1 has to hit — every provider yields the *OpenAI chunk shape*,
 * because `processJsonlStream` is structurally typed against
 * `{choices: [{delta: {content}}]}` rather than against the OpenAI SDK types. A
 * Bedrock adapter that emits that shape drops into the existing JSONL plumbing
 * with no changes to `processJsonlStream` or `extractStableJsonFields`.
 *
 * ## Why `AnthropicBedrock` and not `AnthropicBedrockMantle`
 *
 * TODOS.md Phase 1 specifies the Mantle client. Probing this account, every
 * model ID returns 404/403 on the Mantle endpoint in eu-central-1, us-east-1,
 * and us-west-2 — the requests reach Anthropic and are rejected, so this is
 * entitlement, not a client bug. The legacy `bedrock-runtime` client works today
 * against the same models, so the harness uses it. Revisit if Mantle is enabled
 * for the account later; the seam below is the only thing that would change.
 *
 * ## Why `eu.`-prefixed model IDs
 *
 * Current models reject bare foundation-model IDs for on-demand throughput
 * ("Invocation of model ID ... with on-demand throughput isn't supported") and
 * require a cross-region *inference profile* ID. `aws bedrock
 * list-foundation-models` returns the bare form, which is the wrong one here —
 * `list-inference-profiles` returns what actually works.
 */

/** The chunk shape `processJsonlStream` structurally requires. */
export interface CompletionChunk {
    choices: Array<{ delta?: { content?: string | null } }>;
}

export interface Candidate {
    /** Label shown in the score table. */
    id: string;
    /**
     * `bedrock` speaks the Anthropic Messages API; `bedrock-converse` speaks
     * Bedrock's own Converse API. Both are Bedrock, but they are different
     * wire protocols with different SDKs — only Anthropic models accept the
     * former, and everything else on Bedrock requires the latter.
     */
    provider: "openai" | "bedrock" | "bedrock-converse";
    model: string;
    /**
     * Claude only, and only on models that support adaptive thinking (Sonnet 4.6
     * and newer). Omitted entirely on Haiku 4.5 / Sonnet 4.5, which take the older
     * `budget_tokens` form instead.
     */
    thinking?: "adaptive" | "disabled";
    /** Claude only. Errors on Haiku 4.5 and Sonnet 4.5 — leave unset there. */
    effort?: "low" | "medium" | "high" | "max";
}

/**
 * Why a `disabled` thinking candidate is on the roster despite the risk:
 *
 * Disabling thinking is the obvious cost/latency lever for a streaming path, but
 * on Claude it can leak `<thinking>` tags into the *visible* response. Every
 * endpoint here parses the visible text as JSONL, so a leaked tag corrupts the
 * line it lands on and the parser silently drops that suggestion or recipe
 * section. That failure mode is invisible in aggregate latency numbers, which is
 * exactly why it needs a scorer (`leaks`) and a candidate of its own rather than
 * a note in a doc.
 */
export const DISABLED_THINKING_RISK =
    "thinking:disabled can leak <thinking> tags into visible text, corrupting JSONL";

export const BASELINE: Candidate = {
    id: "gpt-4.1 (baseline)",
    provider: "openai",
    model: "gpt-4.1",
};

/**
 * Confirmed invocable on this account in eu-central-1 (probed 2026-07-30).
 * Ordered cheapest-first so a budget-limited run still covers the likely winner.
 */
export const BEDROCK_CANDIDATES: Candidate[] = [
    {
        id: "haiku-4.5",
        provider: "bedrock",
        model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
    {
        id: "sonnet-4.6 / adaptive-med",
        provider: "bedrock",
        model: "eu.anthropic.claude-sonnet-4-6",
        thinking: "adaptive",
        effort: "medium",
    },
    {
        id: "sonnet-4.6 / no-thinking",
        provider: "bedrock",
        model: "eu.anthropic.claude-sonnet-4-6",
        thinking: "disabled",
    },
    {
        id: "sonnet-4.5",
        provider: "bedrock",
        model: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    },
];

/**
 * OpenAI's **open-weight** models, served through Bedrock's Converse API.
 *
 * These are not the models this app runs. Production is `gpt-4.1` and `gpt-4o`,
 * which are proprietary and reachable only through OpenAI's own API or Azure —
 * they will not appear on Bedrock. So this is a genuine model migration, with
 * the same prompt re-validation burden as moving to Claude, not a way to keep
 * the current models under AWS billing.
 *
 * It earns a place on the roster for one reason: **it is not behind the
 * Anthropic use-case gate.** Probed 2026-08-01 and it answers immediately, so it
 * can measure whether leaving OpenAI's proprietary models is viable at all while
 * the Claude candidates remain blocked on a console approval.
 *
 * Note the bare `openai.` ID: unlike the Anthropic entries, this one is NOT an
 * `eu.` inference profile — `eu.openai.gpt-oss-20b-1:0` returns "provided model
 * identifier is invalid".
 */
export const CONVERSE_CANDIDATES: Candidate[] = [
    {
        id: "gpt-oss-120b",
        provider: "bedrock-converse",
        model: "openai.gpt-oss-120b-1:0",
    },
];

/**
 * Wanted but NOT invocable on this account — every one returns
 * "403 ... is not available for this account". Model access is granted per model
 * in the Bedrock console and cannot be requested from the CLI, so this list is
 * the concrete ask for the remaining Phase 0 checkbox. Move entries into
 * BEDROCK_CANDIDATES once access lands and re-run the sweep.
 */
export const BLOCKED_ON_MODEL_ACCESS = [
    "eu.anthropic.claude-sonnet-5",
    "eu.anthropic.claude-opus-4-8",
    "eu.anthropic.claude-opus-5",
] as const;

/**
 * Bedrock requires an explicit output cap where the OpenAI path sets none.
 * Sized for the longest artefact (a full recipe JSONL), not for the average.
 */
const BEDROCK_MAX_TOKENS = 16_000;

const bedrockClient = () =>
    new AnthropicBedrock({
        awsRegion: process.env.AWS_REGION ?? "eu-central-1",
    });

async function* streamOpenAi(
    candidate: Candidate,
    system: string,
    user: string
): AsyncGenerator<CompletionChunk> {
    // Deliberately mirrors the production call in generate-suggestions-stream.ts:
    // no max_tokens, no sampling overrides. The point of the baseline is to be
    // what production does today, not a tuned version of it.
    const stream = await openai.chat.completions.create({
        model: candidate.model,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        stream: true,
    });

    for await (const chunk of stream) {
        yield chunk;
    }
}

async function* streamBedrock(
    candidate: Candidate,
    system: string,
    user: string
): AsyncGenerator<CompletionChunk> {
    // `output_config` is newer than the installed SDK's types; the wire field is
    // correct, so the cast sits at the parameter boundary rather than the response.
    const params = {
        model: candidate.model,
        max_tokens: BEDROCK_MAX_TOKENS,
        system,
        messages: [{ role: "user" as const, content: user }],
        stream: true as const,
        ...(candidate.thinking ? { thinking: { type: candidate.thinking } } : {}),
        ...(candidate.effort ? { output_config: { effort: candidate.effort } } : {}),
    };

    const stream = await bedrockClient().messages.create(
        params as unknown as Parameters<
            ReturnType<typeof bedrockClient>["messages"]["create"]
        >[0]
    );

    for await (const event of stream as AsyncIterable<{
        type: string;
        delta?: { type?: string; text?: string };
    }>) {
        // Only text deltas become JSONL. Thinking blocks arrive as a different
        // delta type and must not reach the parser — if a `<thinking>` tag shows
        // up downstream of this filter, it leaked into the visible text, which is
        // the failure this harness exists to catch.
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            yield { choices: [{ delta: { content: event.delta.text ?? "" } }] };
        }
    }
}

/**
 * Stream from a non-Anthropic Bedrock model over the Converse API.
 *
 * Converse is Bedrock's own protocol, and it differs from the Anthropic path in
 * two ways that matter here: the system prompt is a separate top-level array
 * rather than a string, and reasoning arrives as `reasoningContent` delta blocks
 * alongside the visible `text` ones.
 *
 * Those reasoning blocks are dropped for exactly the reason thinking deltas are
 * dropped on the Anthropic path — every scorer parses the visible text as JSONL,
 * so reasoning that reached the parser would corrupt the line it landed on and
 * be silently skipped. gpt-oss emits reasoning by default and cannot be asked
 * not to, which makes this filter load-bearing rather than defensive.
 */
async function* streamConverse(
    candidate: Candidate,
    system: string,
    user: string
): AsyncGenerator<CompletionChunk> {
    const { BedrockRuntimeClient, ConverseStreamCommand } = await import(
        "@aws-sdk/client-bedrock-runtime"
    );

    const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION ?? "eu-central-1",
    });

    const response = await client.send(
        new ConverseStreamCommand({
            modelId: candidate.model,
            system: [{ text: system }],
            messages: [{ role: "user", content: [{ text: user }] }],
            inferenceConfig: { maxTokens: BEDROCK_MAX_TOKENS },
        })
    );

    for await (const event of response.stream ?? []) {
        const text = event.contentBlockDelta?.delta?.text;

        if (text) yield { choices: [{ delta: { content: text } }] };
    }
}

export function streamCompletion(
    candidate: Candidate,
    system: string,
    user: string
): AsyncGenerator<CompletionChunk> {
    if (candidate.provider === "openai") return streamOpenAi(candidate, system, user);
    if (candidate.provider === "bedrock-converse") {
        return streamConverse(candidate, system, user);
    }

    return streamBedrock(candidate, system, user);
}
