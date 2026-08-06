# @fridgeezy/bedrock

Claude-on-Bedrock client for the model migration (Phase 1). Mirrors the shape of
`libs/openai` / `libs/genai`: a client module plus per-service modules.

```ts
import { streamCompletion, createCompletion } from "@fridgeezy/bedrock";
import { processJsonlStream } from "@fridgeezy/streaming-server";

const stream = streamCompletion({ system, user, effort: "low" });

for await (const { parsed } of processJsonlStream(stream, schemas)) {
    // …unchanged from the OpenAI path
}

// One-shot, for the short adjudicator calls that parse a single JSON object.
const text = await createCompletion({ system, user, maxTokens: 512 });
```

## Why it emits OpenAI-shaped chunks

`processJsonlStream` is structurally typed against
`{ choices: [{ delta: { content } }] }`, not against the OpenAI SDK types. An
adapter that yields that shape therefore drops into every existing streaming call
site with no change to the parser or to `extractStableJsonFields` — and makes an
OpenAI-vs-Bedrock A/B a one-line swap at the call site.

## Account-specific facts this encodes

These cost a day to find in Phase 0. They are properties of *this* AWS account and
are not documented by the CLI:

- **Use `AnthropicBedrock`, not `AnthropicBedrockMantle`.** Every model ID 404/403s
  on the Mantle endpoint across eu-central-1, us-east-1 and us-west-2. Requests
  reach Anthropic and are rejected, so it is entitlement, not a client bug.
- **Model IDs must be inference profiles** — the `eu.anthropic.*` form. Bare
  `anthropic.*` IDs fail with *"Invocation … with on-demand throughput isn't
  supported"*. `aws bedrock list-foundation-models` returns the bare form, so it is
  not a source for this value.
- **`max_tokens` is required**, where the OpenAI path sets no cap — and it bounds
  thinking *and* visible text together, so a budget sized for the answer alone
  starts truncating the moment thinking is on.
- **Do not disable thinking** on streaming paths: Claude can then leak
  `<thinking>` tags into the visible response, corrupting the JSONL line they land
  on — and a corrupt line is dropped silently, so it reads as missing content
  rather than an error.
- **Omitting `thinking` is not the same as disabling it, and the models
  disagree about which.** Sonnet 4.6 runs without thinking when the field is
  absent; Sonnet 5 runs adaptive. An absent `effort` is `high` on both. So
  `buildParams` sends both fields on every request from `DEFAULT_THINKING` /
  `DEFAULT_EFFORT` — otherwise a model bump moves the bill (thinking bills as
  output) and the truncation risk with nothing to flag it. There is no "send
  neither" state: Haiku 4.5 and Sonnet 4.5 reject this pair, so switching to
  either is a change that comes through `build-params.ts`.
- Neither `get-foundation-model-availability` nor `list-foundation-models` is a
  usable access check; both reported models that then returned 403. Invoke and
  read the error.

## Configuration

| Env | Default | Notes |
| --- | --- | --- |
| `AWS_REGION` | `eu-central-1` | Serves the Claude family; matches the Lambda infra. |
| `BEDROCK_MODEL_ID` | `eu.anthropic.claude-sonnet-4-6` | Inference profile ID. Sonnet 5 once access lands. Check `DEFAULT_THINKING`/`DEFAULT_EFFORT` support before changing this. |

Output caps are per call site, not per env. `BEDROCK_MAX_TOKENS` (32k) is the
**streaming** default; every one-shot caller names its own `TokenLimit.bedrock`
so a short verdict can't inherit a recipe-sized budget.

Auth comes from the AWS credential chain (IAM role in Lambda, profile or env
locally) — there is no API key to validate at import, so a missing credential
surfaces on the first call rather than at startup.

## Status

Builds and typechecks; **not yet validated against a live model.** Anthropic
models are gated on this account behind the Bedrock console use-case form
(*"Model use case details have not been submitted for this account"*) — as of
2026-07-30 that includes `claude-sonnet-4-6`, so no Anthropic model is invocable.
Non-Anthropic Bedrock works (Cohere Embed v4, Nova), so the gate is
Anthropic-specific entitlement, not Bedrock access.

Verified so far: a live call reaches Bedrock and comes back with the access-gate
error — proving credentials, region, the inference-profile ID form and the request
shape are all correct — and fails no earlier. The response-parsing half is
unexercised against a live model until access lands, though the streaming half of
it is covered offline by
`apps/api/src/evals/model-migration/streaming-conformance.check.ts`.

`createCompletion` splits its response handling into `toCompletionText` for the
same reason `streamCompletion` splits out `toCompletionChunks`: the transform can
be driven from a recorded response while access is gated. `toCompletionText` has
no offline check of its own yet — the conformance harness covers the streaming
path only.
