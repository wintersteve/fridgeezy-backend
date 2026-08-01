# @fridgeezy/llm

Provider-neutral inference facade. Call sites name a model, not an SDK, so
OpenAI and Bedrock can be A/B'd behind one env var.

```ts
import { generateStream } from "@fridgeezy/llm";
import { processJsonlStream } from "@fridgeezy/streaming-server";

const stream = generateStream({
    model: { openai: "gpt-4.1" }, // bedrock falls back to BEDROCK_MODEL_ID
    system: SYSTEM_PROMPT,
    user: userPrompt,
});

for await (const { parsed } of processJsonlStream(stream, schemas)) {
    // …unchanged
}
```

`generateCompletion(...)` is the one-shot equivalent for the adjudicators.

## Switching provider

| `LLM_PROVIDER` | Behavior |
| --- | --- |
| unset / `openai` | OpenAI (**default** — production behavior is unchanged) |
| `bedrock` | Claude on Bedrock via `@fridgeezy/bedrock` |
| anything else | throws at the call |

The default is deliberate: the migration plan gates Bedrock on matching or
beating the OpenAI baseline on the eval set, so landing this lib must not move
traffic. A typo throws rather than falling back, because the silent failure mode
— a deployed function still serving OpenAI while looking switched over — is much
worse than a loud one. Per-call `provider` overrides the env, which is how the
eval harness runs both sides in one process.

## Things that are not symmetric between providers

The facade is thin on purpose; where the providers genuinely differ it says so
rather than pretending parity:

- **`maxTokens` means different things on the two entry points.** On
  `generateStream` it is Bedrock-only: Bedrock requires an output cap, and the
  OpenAI branch is deliberately left uncapped because that is what production
  does today, so the eval compares against an untouched baseline. On
  `generateCompletion` it is a `TokenLimit` — **one cap per provider**, because
  the two numbers are not conversions of each other. The adjudicators cap OpenAI
  at 10-30 tokens, which is ample for `{"same":true}` from a model that answers
  immediately but is spent by a thinking model before it emits any visible text
  (and Anthropic rejects a cap that doesn't clear the thinking budget). Carrying
  one number across would either truncate every Bedrock verdict or uncap every
  OpenAI one.
- **`json` is not enforced on Bedrock.** On OpenAI it sets
  `response_format: { type: "json_object" }`, which the API enforces. Bedrock has
  no equivalent field, so the *prompt* has to ask for JSON there.
- **`thinking` / `effort` are Bedrock-only** and ignored on OpenAI.
- Clients are imported **lazily, on the branch that uses them**: `libs/openai`
  throws at import when `OPENAI_API_KEY` is unset, so a static import would make
  an OpenAI key a hard boot requirement for a function running entirely on
  Bedrock.

## Who uses it

Every text call site in `apps/api` routes through here as of the Phase 1 swap:

| Entry point | Call sites |
| --- | --- |
| `generateStream` | suggestions (batch + single), recipe generate / modify / escalate, promote, compose, substitutes |
| `generateCompletion` | the three adjudicators — dish dedup, ingredient validation, authenticity |

Each streaming service that previously took a `client?: OpenAI` now takes an
optional `provider` instead. That parameter existed as an A/B seam but could only
ever inject an OpenAI client, so it could not express the comparison it was there
for; no caller passed one.

## Not covered

Three things still import `@fridgeezy/openai` directly, each with its own
checkbox in the migration plan:

- **Chat** (`create-chat-completion.ts`) — multi-turn plus tool calling, which
  has no shared shape between the two SDKs.
- **Ingredient extraction** — image input, which Anthropic models take in a
  different message shape.
- **Embeddings** (`generateEmbedding`) — Phase 4, and a corpus migration rather
  than a code change.

Because of those, `OPENAI_API_KEY` is still a hard boot requirement for the API:
`libs/openai` throws at *import*, and the embedding call sites import it at top
level. The lazy imports in this lib remove that requirement from the paths it
covers, but not from the process as a whole — a Bedrock-only deployment needs
those three ported first.

## Status

Verified against live providers:

- provider resolution: default, env override, and that an unknown value throws
- the OpenAI branch streams through the real `processJsonlStream` and parses
  multi-line JSONL correctly — the production plumbing, not a stub
- the one-shot path including the `json` flag
- the Bedrock branch reaches Bedrock and returns the account's use-case gate

Not verified: anything past that gate on the Bedrock side. See
`libs/bedrock/README.md`. In particular, **no Bedrock call site has run
end-to-end** — the swap changes which code path production takes only when
`LLM_PROVIDER=bedrock`, which nothing sets.
