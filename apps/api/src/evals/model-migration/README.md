# Phase 0 — Bedrock model eval harness

The gate for the inference half of the AWS migration (`TODOS.md`). Runs a fixed
input set through the OpenAI baseline and each Bedrock candidate with
**byte-identical prompts**, and scores authenticity + structure adherence.

Phase 1 does not ship until a candidate matches or beats the baseline here.

## Running

```bash
# plumbing check — one fixture per path, no authenticity judging
npx nx run @fridgeezy/api:eval-model-migration -- --quick

# a run you can actually decide on
npx nx run @fridgeezy/api:eval-model-migration -- --repeat=5
```

Or directly, from `apps/api`: `npx jiti src/evals/model-migration/run.eval.ts …`

| Flag | Effect |
|---|---|
| `--quick` | One fixture per path, skips the authenticity judge |
| `--repeat=N` | Run each fixture N times (default 1) |
| `--skip-authenticity` | Skip the LLM authenticity judge — the priciest scorer |
| `--skip-recipes` | Skip the recipe path — the only one needing Supabase |
| `--skip-substitutes` | Skip the substitutes path |
| `--only=<substring>` | Restrict to candidates whose id matches |

**This costs real money on both providers.** Start with `--quick`.

## Use `--repeat` for anything that informs a decision

Measured on the baseline: the same fixture scored **0/4** on tag cardinality in
one run and **4/4** in the next. One sample per fixture is noise. Use
`--repeat=5` or higher before treating a delta between candidates as real.

## Scorers

| Column | Asks |
|---|---|
| `jsonl` | Did the model emit the structure the prompt demands? Suggestions: exactly 4 parseable lines. Recipes: header + nutrition + one line per requested ingredient. Substitutes: one answered line per requested ingredient, name echoed exactly |
| `tags` | Exactly 1 component, 1 cuisine, 1 course tag — scored against the live `tags` table, not a hardcoded list |
| `ingr` | Are the dish-defining ingredients present, and blacklisted ones absent? |
| `real` | The production authenticity gate (`verifySuggestionAuthenticity`) |
| `nutr` | Nutrition present *and* non-zero — a zeroed nutrition line passes schema validation but is useless in the app |
| `leaks` | `<thinking>` tags or markdown fences in the visible text |

`jsonl` counts *dropped* lines, which is the failure mode that matters: a
malformed line fails schema validation and is silently skipped, so a structural
regression shows up as a short recipe rather than as an error.

## Why substitutes is scored on coverage, not prose

`/rest/substitutes/generate` was added after this harness and was not covered by
it — so the Phase 1 gate would have passed without ever exercising an endpoint
the migration moves. It is scored now, on whether every requested ingredient
comes back answered under the name it was asked for.

Coverage rather than quality, because coverage is the part the service cannot
paper over. `generate-substitutes-stream` already buffers out-of-order lines,
drops duplicates, and fills anything the model skipped with a fallback frame. A
model that renames ingredients therefore yields a card full of fallbacks rather
than an error — silent in production, and invisible to every other scorer here.

The fixtures need no database: the prompt is built with a null recipe, so it
falls back to `recipeName`.

The authenticity judge stays on OpenAI for every candidate on purpose — a judge
that moved with the candidate would measure the pair, not the candidate.

## Why `leaks` has a candidate of its own

Disabling thinking is the obvious cost/latency lever for a streaming path, but on
Claude it can leak `<thinking>` tags into the **visible** response. Every endpoint
here parses visible text as JSONL, so a leaked tag corrupts its line and the
parser drops it. That is invisible in latency and cost numbers, so
`sonnet-4.6 / no-thinking` is on the roster specifically to catch it.

## Known blocker — model access

Probed 2026-07-30 on this AWS account:

| Path | Result |
|---|---|
| `AnthropicBedrockMantle` (the client `TODOS.md` Phase 1 specifies) | 404/403 in eu-central-1, us-east-1, us-west-2 |
| `AnthropicBedrock` + `eu.`-prefixed inference profiles | Worked, then began returning **"Model use case details have not been submitted for this account"** |
| Bare `anthropic.*` foundation-model IDs | "Invocation … with on-demand throughput isn't supported" — current models require an inference profile |
| Sonnet 5 / Opus 5 / Opus 4.8 | "not available for this account" |

**The remaining Phase 0 action is a console one:** submit the Anthropic use-case
details form in the Bedrock console, and request access for the models in
`BLOCKED_ON_MODEL_ACCESS` (`candidates.ts`). Neither can be done from the CLI.
Until that lands, the Bedrock half of the sweep cannot run — the baseline half
works today.

Note `aws bedrock get-foundation-model-availability` reported
`AUTHORIZED / AVAILABLE` for models that then returned 403. It describes region
and entitlement availability, not this account's granted access — don't use it as
the access check.
