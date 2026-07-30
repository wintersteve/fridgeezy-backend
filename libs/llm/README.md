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

- **`maxTokens` is Bedrock-only.** Bedrock requires an output cap; the OpenAI
  branch is deliberately left uncapped because that is what production does
  today, and the eval only means something if the baseline is untouched.
- **`json` is not enforced on Bedrock.** On OpenAI it sets
  `response_format: { type: "json_object" }`, which the API enforces. Bedrock has
  no equivalent field, so the *prompt* has to ask for JSON there.
- **`thinking` / `effort` are Bedrock-only** and ignored on OpenAI.
- Clients are imported **lazily, on the branch that uses them**: `libs/openai`
  throws at import when `OPENAI_API_KEY` is unset, so a static import would make
  an OpenAI key a hard boot requirement for a function running entirely on
  Bedrock.

## Not covered

Two call sites need more than text-in/text-out and are left on the OpenAI SDK
for now — both have their own checkbox in the migration plan:

- **Chat** (`create-chat-completion.ts`) — multi-turn plus tool calling, which
  has no shared shape between the two SDKs.
- **Ingredient extraction** — image input, which Anthropic models take in a
  different message shape.

## Status

Verified against live providers:

- provider resolution: default, env override, and that an unknown value throws
- the OpenAI branch streams through the real `processJsonlStream` and parses
  multi-line JSONL correctly — the production plumbing, not a stub
- the one-shot path including the `json` flag
- the Bedrock branch reaches Bedrock and returns the account's use-case gate

Not verified: anything past that gate on the Bedrock side. See
`libs/bedrock/README.md`.
