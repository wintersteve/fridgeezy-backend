# TODOS — Migrate to AWS Lambda + Amazon Bedrock

Created 2026-07-28.

Goal: move the orchestration server (`apps/api`) from a long-running Express
process onto **AWS Lambda**, and move model inference from **OpenAI + Google
Gemini** onto **Amazon Bedrock**.

These are two independent migrations bundled into one effort:
- **Hosting:** Express → Lambda (compute).
- **Inference:** OpenAI/Gemini → Bedrock (models).

Do them as separate, independently-shippable phases — don't couple a model swap
to a hosting swap in the same PR, or a regression becomes impossible to bisect.

## Status as of 2026-08-06 — read this before the phases

The two halves are in very different places, and the file's structure hides it:

- **Hosting is DONE and deployed.** Phase 3 is complete and verified against real
  AWS. Lambda is what serves traffic today. Nothing below reopens that, and
  nothing about the Bedrock decision changes it — they are independent, which is
  the point of the split above.
- **Inference is BUILT but PARKED.** Phase 1 ported all 11 text call sites; no
  module in `apps/api` imports a provider SDK. `LLM_PROVIDER` still defaults to
  `openai`, so **no traffic has ever run on Bedrock**, and none can: the account's
  Anthropic entitlement gate blocks every model (see Phase 0's last checkbox).

**The open question is no longer "can we build it" but "should we switch", and
that is deliberately being answered with measurements rather than estimates.**
What a cutover buys is operational — IAM instead of an API key, one AWS bill,
in-region inference — against a token bill estimated at ~2x, recoverable toward
parity with prompt caching and per-call-site model choice, and a full prompt
re-validation on a set of prompts tuned against `gpt-4.1`/`gpt-4o`. The
instrumentation to replace those estimates with real numbers landed 2026-08-06
(Phase 5, first checkbox); the comparison itself still waits on the console gate.

**Do not delete `libs/bedrock` while parked.** It costs nothing to carry — it has
no runtime path — and it holds account-specific findings that exist nowhere else:
the inference-profile ID form, the `AnthropicBedrockMantle` entitlement gap, the
`data:`-prefix trap, and the fact that neither `list-foundation-models` nor
`get-foundation-model-availability` is a usable access check. It is also the
difference between a `gpt-4.1` deprecation being a config change and a project.

---

## ⚠️ Read first — known risks this migration takes on

These were flagged during evaluation. They don't block the work, but they must
be owned deliberately, not discovered in prod.

- **Accuracy re-validation (highest risk).** Every prompt is tuned and validated
  on `gpt-4.1` / `gpt-4o`. Bedrock serves Claude / Nova / Titan, not those
  models. Recipe authenticity + structure adherence must be re-validated against
  the new model family before cutover. Accuracy is the #1 product priority — treat
  the eval harness (Phase 0) as a prerequisite, not a nicety.
- **SSE + Lambda needs Function URLs, not API Gateway.** The entire app streams
  (recipes, suggestions, chat). API Gateway REST/HTTP APIs buffer the response
  and break SSE. Streaming requires Lambda **response streaming** via a Function
  URL (or ALB). See Phase 3.
- **Idle-wait billing.** A recipe stream holds ~15–30s mostly waiting on the
  model. Lambda bills that wall-clock time. Acceptable at low volume; revisit if
  volume grows (a container would be cheaper past ~25–30k streaming req/month).
- **Embeddings swap is a corpus-wide migration**, not a code change. See Phase 4.

---

## Current-state inventory (what has to move)

Model call sites today:

| Operation | File | Model |
|---|---|---|
| Suggestions (4× JSONL) | `apps/api/src/modules/suggestions/services/generate-suggestions-stream.ts` | `gpt-4.1` |
| Single suggestion | `apps/api/src/modules/suggestions/services/stream-single-suggestion.ts` | `gpt-4.1` |
| Full recipe | `apps/api/src/modules/recipes/usecases/generate-recipe/generate-recipe.ts` | `gpt-4.1` |
| Modify recipe | `apps/api/src/modules/recipes/usecases/modify-recipe/modify-recipe.ts` | `gpt-4.1` |
| Escalate difficulty | `apps/api/src/modules/recipes/usecases/escalate-difficulty/escalate-difficulty.ts` | `gpt-4.1` |
| Compose suggestions | `apps/api/src/modules/recipes/services/generate-compose-suggestions.ts` | `gpt-4.1` |
| Promote | `apps/api/src/modules/suggestions/usecases/promote/promote.ts` | `gpt-4.1` |
| Substitutes | `apps/api/src/modules/substitutes/services/generate-substitutes-stream.ts` | `gpt-4.1` |
| Chat / recipe-chat | `chat.schema.ts` default `gpt-4o` | `gpt-4o` |
| Ingredient extraction (vision) | `apps/api/src/modules/ingredients/usecases/extract-ingredients/extract-ingredients.ts` | `gpt-4o` |
| Embeddings | `libs/openai/src/lib/modules/embeddings/*` | `text-embedding-3-small` |
| Recipe images | `libs/genai/*` | `gemini-2.5-flash-image` |

Shared streaming plumbing that must keep working regardless of provider:
`processJsonlStream` + `extractStableJsonFields` (`libs/streaming-server`,
`apps/api/src/modules/suggestions/services/extract-stable-json-fields.ts`).

**Substitutes was missing from this table** until 2026-08-01. The endpoint was
built after this inventory was written, so it was neither listed here nor covered
by the Phase 0 eval — meaning the Phase 1 gate could have passed without ever
exercising it. Both are fixed. Add new streaming endpoints to this table *and* to
the harness when they land, or the gate quietly narrows.

---

## Phase 0 — Decisions & eval harness (do before writing migration code)

- [x] **Pick the Bedrock text model.** Claude, as expected. Which Claude is
      constrained by account access, not preference: **Sonnet 4.6**
      (`eu.anthropic.claude-sonnet-4-6`) is the best model actually invocable
      today. Sonnet 5 is the target once access lands — it is the current Sonnet
      and its adaptive-thinking/effort surface is what the harness already sends.
      Nova is not worth evaluating until Claude has a baseline to beat.
- [x] **Pick the vision model** for ingredient extraction: same model as the text
      path (Claude on Bedrock takes image input). Worth knowing for later:
      high-resolution vision (2576px long edge, ~3x the image tokens) arrives at
      Sonnet 5 — Sonnet 4.6 caps at 1568px, so re-check extraction accuracy
      rather than assuming it carries over.
- [x] **Decide embeddings target: Cohere Embed v4** (`eu.cohere.embed-v4:0`,
      available in eu-central-1) over Titan v2. Reason: v4 emits 1536-dim
      vectors, matching the 24 existing `vector(1536)` columns, so no column
      migration for those. Titan v2 maxes at 1024 and would force one.
      **Correction to Phase 4's framing:** matching dimensions does *not* avoid
      the re-embed — the vector spaces differ, so the whole corpus must be
      re-embedded regardless. Matching dimensions only avoids the schema change.
      The 10 `vector(3072)` columns have no Bedrock equivalent at that width and
      need a column change either way.
- [x] **Decide image model:** keep Gemini (option a). Images aren't what this
      migration is for, and Bedrock has no drop-in for the illustration style.
- [x] **Build an eval harness** — `apps/api/src/evals/model-migration/`
      (see its README). Fixed input set, byte-identical prompts, five scorers
      (real dish / core ingredients / tag cardinality / valid JSONL / nutrition
      non-zero) plus a leak counter. Run with
      `npx nx run @fridgeezy/api:eval-model-migration -- --repeat=5`.
      **Use `--repeat`:** the baseline scored 0/4 then 4/4 on tag cardinality
      across consecutive single-sample runs — one sample per fixture is noise.
- [x] Choose AWS region: **eu-central-1**. Serves the Claude family and matches
      where the Lambda infra is defined.
- [ ] ⚠️ **BLOCKED — console action required.** Bedrock returns *"Model use case
      details have not been submitted for this account"*. Submit the Anthropic
      use-case form in the Bedrock console, then request access for the models in
      `BLOCKED_ON_MODEL_ACCESS` (`candidates.ts`): Sonnet 5, Opus 4.8, Opus 5.
      Neither step is possible from the CLI. **The Bedrock half of the eval
      cannot run until this lands** — the OpenAI baseline half works today.
      **Re-probed 2026-07-30 and it got worse:** the gate now also catches
      `eu.anthropic.claude-sonnet-4-6`, recorded above as the best invocable model
      — so *no* Anthropic model runs on this account today, and the eval has no
      Bedrock candidate at all, not just a limited one. Non-Anthropic Bedrock is
      unaffected: `eu.cohere.embed-v4:0` and `eu.amazon.nova-micro-v1:0` both
      invoke fine in eu-central-1, so this is Anthropic entitlement, not Bedrock
      access. Cohere Embed v4 was confirmed to return **1536-dim** vectors on this
      account, which settles the Phase 4 embedding decision empirically.

### Phase 0 findings that change Phase 1

- **`AnthropicBedrockMantle` does not work on this account.** Every model ID
  returns 404/403 on the Mantle endpoint across eu-central-1, us-east-1, and
  us-west-2 — requests reach Anthropic and are rejected, so it is entitlement,
  not a client bug. The harness uses the legacy `AnthropicBedrock`
  (`bedrock-runtime`) client, which works. Phase 1's "use the Mantle client"
  instruction needs revisiting.
- **Model IDs must be inference profiles, not foundation models.** Bare
  `anthropic.*` IDs fail with *"Invocation … with on-demand throughput isn't
  supported"*; the `eu.anthropic.*` profile form works. Note `aws bedrock
  list-foundation-models` returns the wrong form, and
  `get-foundation-model-availability` reported `AUTHORIZED / AVAILABLE` for
  models that then returned 403 — neither is a usable access check.
- **The JSONL port is smaller than Phase 1 assumes.** `processJsonlStream` is
  structurally typed against `{choices:[{delta:{content}}]}`, not against the
  OpenAI SDK types, so a Bedrock adapter that emits that shape drops in with no
  change to `processJsonlStream` or `extractStableJsonFields`.
- **Do not disable thinking to save tokens on the streaming paths.** On Claude it
  can leak `<thinking>` tags into the *visible* response, which corrupts the
  JSONL line it lands on and gets that line silently dropped. Prefer adaptive
  thinking at low/medium effort. The harness carries a `no-thinking` candidate
  and a leak counter specifically to measure this.

---

## Phase 1 — Bedrock inference swap (model layer only, still on Express)

Ship this while still running the existing Express server locally, so the model
change is validated in isolation before touching hosting.

- [x] Add a Bedrock client lib (mirror `libs/openai` / `libs/genai` shape):
      **`libs/bedrock`** (`@fridgeezy/bedrock`, see its README) — client +
      `streamCompletion` (OpenAI-shaped chunks, thinking deltas filtered out) +
      `createCompletion` for the non-streaming call sites. Region and model come
      from `AWS_REGION` / `BEDROCK_MODEL_ID`; auth via the AWS credential chain
      (IAM role in Lambda, profile locally), so there is nothing to validate at
      import.
      **Corrects this checkbox's original instructions, per the Phase 0 findings:**
      use the legacy **`AnthropicBedrock`** client — `AnthropicBedrockMantle` is
      not entitled on this account — and model IDs must be **inference profiles**
      (`eu.anthropic.*`), not the bare `anthropic.*` foundation-model form.
      *Builds and lints; unvalidated against a live model.* A real call reaches
      Bedrock and returns the account's use-case gate, which proves credentials,
      region, model-ID form and request shape are right; response parsing is
      unexercised until access lands.
- [x] Introduce a thin **provider abstraction** so call sites don't hard-code the
      SDK — one `generateStream(...)` that yields text deltas. This keeps
      `processJsonlStream` unchanged (it accumulates a text stream and doesn't
      care about the provider) and lets you A/B OpenAI vs Bedrock behind a flag.
      **`libs/llm`** (`@fridgeezy/llm`, see its README): `generateStream` +
      `generateCompletion`, provider from `LLM_PROVIDER` (**default `openai`**, so
      landing it moves no traffic; an unknown value throws) with a per-call
      `provider` override for A/B. Models are named per provider
      (`{ openai: "gpt-4.1" }`), Bedrock falling back to `BEDROCK_MODEL_ID`.
      Verified live: provider resolution, and the OpenAI branch streaming through
      the real `processJsonlStream` into parsed JSONL.
      **Asymmetries it deliberately does not paper over:** `maxTokens` is
      Bedrock-only (OpenAI stays uncapped so the baseline is unchanged); `json`
      maps to `response_format` on OpenAI but is a no-op on Bedrock, where the
      prompt must ask for JSON; `thinking`/`effort` are Bedrock-only.
      **Found while building it:** `libs/openai` throws at *import* on a missing
      `OPENAI_API_KEY`, so the facade imports each client lazily — otherwise a
      Bedrock-only Lambda would still need an OpenAI key to boot. Watch for the
      same trap in any other module that imports the OpenAI client at top level.
- [x] Port the streaming shape: OpenAI `chat.completions.create({stream:true})`
      → Bedrock/Anthropic Messages streaming. The translation is
      `toCompletionChunks` (`libs/bedrock`), split out of `streamCompletion` so it
      can be driven from recorded events instead of a live model — which is what
      makes it verifiable while account access is still gated.
      Verified by `apps/api/src/evals/model-migration/streaming-conformance.check.ts`
      (`npx nx run @fridgeezy/api:check-streaming-conformance`) — **offline,
      deterministic, no keys, no spend**, so it can gate CI later. 20 checks
      across five chunking regimes (1 char → whole payload) assert: thinking
      deltas never reach visible text; JSONL parses byte-identically to the
      OpenAI baseline; and revealed fields are monotonic, never revised after
      being shown, complete, and in prompt order.
      Confirmed to fail when it should: inverting the thinking filter turns 18 of
      20 red, including a key corrupted to
      `"ingr<thinking>reconsidering</thinking>edients"`.
      **Finding — reveal granularity is coarser on Bedrock.** Anthropic's larger
      deltas produce **3 reveal frames where OpenAI produces 6** for the same
      object. Still correct (monotonic, stable, ordered), but the single-suggestion
      card will animate in fewer, bigger jumps. A product call, not a bug —
      decide it when porting `streamSingleSuggestion`, not after.
      **Blocker for the next checkbox — now resolved,** see below.
- [x] Swap each text call site (table above) behind the flag. Keep system/user
      prompts **byte-identical** at first — change only the transport — so the
      eval isolates model behavior from prompt changes.
      Done for all 11 text call sites: the 8 streaming ones (suggestions batch +
      single, recipe generate/modify/escalate, promote, compose, substitutes) now
      call `generateStream`, and the 3 one-shot adjudicators (dish dedup,
      ingredient validation, authenticity) call `generateCompletion`. Prompts are
      untouched. **`LLM_PROVIDER` still defaults to `openai`, so this moves no
      traffic** — it only makes the Bedrock path reachable by env var.
      **`generateCompletion` and `createCompletion` had to be written first.**
      Both READMEs documented them as existing; neither did. Written now, with
      `createCompletion` split into `toCompletionText` so the response transform
      is drivable from a recorded response, mirroring `toCompletionChunks`.
      **Found: the token cap does not carry across providers.** The adjudicators
      cap OpenAI at 10-30 tokens — ample for `{"same":true}`, but a thinking model
      spends that before emitting any visible text, and Anthropic rejects a cap
      that doesn't clear the thinking budget. `generateCompletion` therefore takes
      a `TokenLimit` (`{ openai?, bedrock? }`) rather than one number, the same way
      `ModelSelection` already handles model IDs.
      **The Bedrock caps are now set** (2026-08-06): 1024 on the two short
      adjudicators, 2048 on authenticity, 8000 on extraction. Still unvalidated
      against a live model — the numbers clear a low/medium-effort thinking pass
      by construction, not by measurement — but they are no longer inheriting the
      streaming fallback, which would have allowed 32k billed output tokens on a
      `{"same":true}` verdict.
- [x] **Send an explicit thinking mode on every Bedrock request** (2026-08-06).
      `buildParams` previously omitted `thinking` and `output_config` unless a
      call site passed them. Omission is not "off": Sonnet 4.6 reads an absent
      `thinking` as no thinking, Sonnet 5 reads it as adaptive, and an absent
      `effort` is `high` on both. So a `BEDROCK_MODEL_ID` bump would have changed
      the bill and the truncation risk with nothing to flag it — thinking bills as
      output and shares `max_tokens` with the visible text. Both fields are now
      sent unconditionally from `DEFAULT_THINKING`/`DEFAULT_EFFORT`
      (adaptive/medium, matching the eval's leading candidate), and
      `BEDROCK_MAX_TOKENS` went 16k → 32k because the old figure budgeted for a
      full recipe JSONL *before* thinking took a share of it.
      **There is deliberately no "omit both" state.** Haiku 4.5 and Sonnet 4.5
      reject this pair, so pointing `BEDROCK_MODEL_ID` at either has to come
      through `build-params.ts` rather than silently half-working.
      **The `client?: OpenAI` seam is gone**, replaced by an optional `provider`.
      It could only ever inject an OpenAI client, so it could not express the A/B
      it existed for; nothing passed one. That also resolves the previous
      checkbox's blocker: `streamSingleSuggestion`'s reveal loop is now the
      exported `accumulateSuggestionReveals`, and the conformance check drives
      **that function** instead of a verbatim copy — 20/20 still pass, with
      identical reveal counts, so the collapse changed no behaviour.
      **`OPENAI_API_KEY` is still required to boot** — but by 2026-08-06 only
      because of **embeddings**. Chat and ingredient extraction were both ported
      (chat calls `generateChatStream` from `@fridgeezy/llm`; extraction calls
      `generateCompletion`), so the only production code left importing
      `libs/openai` at top level is `generateEmbedding` / `generateBatchEmbeddings`
      — which throws at import. That is Phase 4, and Phase 4 is recommended cut,
      so **the key cannot be dropped without reversing that decision.** See the
      note at the head of Phase 4.
- [x] Port the **vision** path (ingredient extraction) to the Bedrock vision model.
      Extraction is one-shot, so it runs through `generateCompletion` with an
      `image` parameter rather than needing its own entry point. The providers
      differ only in the wrapper: OpenAI takes one `image_url` string with base64
      as a data URI, Anthropic a `source` object naming `media_type` separately —
      `toAnthropicImageBlock` handles that, and strips a `data:` prefix if the
      caller passes one, since sending it inside the base64 field fails
      server-side with an opaque error.
      **`generateCompletion` now returns `{ text, finishReason }`.** Extraction
      caps output and reports a specific "try a clearer image" error when the
      model is cut off, and truncation is only distinguishable from plain bad
      JSON by the stop reason — the old bare-string return threw that away. The
      three adjudicators read `.text` and ignore it.
      **`detail: "high"` has no Anthropic counterpart.** Anthropic picks the
      resolution itself, and Sonnet 4.6 caps the long edge at 1568px against
      Sonnet 5's 2576px. Extraction accuracy on busy images is therefore a
      per-model question this translation does *not* preserve — measure it, per
      the Phase 0 note, rather than assuming it carries over.
      Verified on the OpenAI branch end to end with a real photo: 12 ingredients
      with correct hierarchy (`red_bell_pepper` -> `bell_pepper`). Offline
      coverage for the Anthropic wrapper is in the conformance check, now 40
      assertions.
      **This completes the call-site swap.** No module in `apps/api` imports a
      provider SDK any more; `openai` has been dropped from its dependencies. The
      only remaining direct `@fridgeezy/openai` imports are `generateEmbedding`
      (Phase 4, a corpus migration) and the eval harness's deliberate baseline.
- [ ] Run the Phase 0 eval harness on every path. Re-tune prompts only where the
      new model regresses; record before/after scores.
- [ ] **Gate:** do not proceed to hosting until authenticity + structure scores
      match or beat the OpenAI baseline on the eval set.

---

## Phase 2 — MCP session state (unblock Lambda) — RESOLVED BY REMOVAL

- [x] Deleted 2026-07-31. The `/mcp` endpoint, its `StreamableHTTPServerTransport`
      session map, and the `@modelcontextprotocol/sdk` dependency are gone. The
      endpoint had no caller (the RN client only ever hit `/rest`) and was in fact
      unreachable — `app.all("/mcp", …)` doesn't strip the mount path, so its
      router's `POST /chat` never matched. Chat keeps using the tool *definitions*
      (`modules/ai/tools`) converted to OpenAI function schemas. No session state
      is left to externalize, so nothing blocks Lambda here.

---

## Phase 3 — Lambda hosting

- [x] Wrap the app for Lambda — took option (a): `apps/api/src/lambda.ts` binds
      the app to a loopback port and proxies each invocation to it. Route
      assembly moved to `create-app.ts`, shared with `main.ts`, so local and
      Lambda serve the same app. The loopback hop is what preserves the raw-body
      handling `express-app.ts` depends on.
- [x] Use **Lambda response streaming** (`awslambda.streamifyResponse`) via a
      **Function URL**. Verified locally that chunks surface at the producer's
      cadence rather than being buffered. **Do not** front the streaming
      endpoints with API Gateway — it buffers and breaks SSE.
- [x] Keep the parallel fire-and-forget image generation working — both call
      sites (`generate-recipe.ts`, `promote.ts`) now register through
      `apps/api/src/background-tasks.ts`, and the handler drains that registry
      after the response closes but before returning. Client latency is
      unaffected; billed duration is not. If image generation starts dominating
      duration, move it to a separate async invocation / queue — the registry is
      the seam for that.
- **Merge note:** `create-app.ts` originally also mounted `app.all("/mcp", …)`.
  That route was dropped when Phase 3 merged into a main where the MCP transport
  had already been removed (Phase 2, resolved by removal), so `createApp` now
  mounts `/rest` only.
- [x] IAM role for the function — `iam.tf`: CloudWatch Logs, Bedrock invoke
      (both streaming and not), SSM parameter read, and `kms:Decrypt` for the
      SecureString parameters. Supabase is reached over HTTPS with keys from env,
      so it needs no IAM.
- [x] Port env/config — five SSM parameters (`OPENAI_API_KEY`, `GOOGLE_API_KEY`,
      `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) loaded by
      `put-secrets.sh` and injected as Lambda env vars (`lambda.tf:26-38`). No
      `dotenv` in Lambda. **Caveat:** Terraform reads these at apply time, so the
      values land in state in plaintext — see the follow-up below.
- [x] IaC: **Terraform**, checked in at [`infra/`](infra/README.md). Defines the
      function, Function URL (`RESPONSE_STREAM`), IAM (logs + Bedrock + SSM),
      log group, and per-environment tfvars. The session-store item is gone with
      Phase 2 (resolved by removal); the S3 state backend is still open.
- [x] Set `max` timeout headroom and a sane memory size — 300s / 1024 MB,
      `nodejs22.x` on arm64. Cold start measured on the deployed function:
      **~1.0–1.9s** to first byte, ~70–120ms warm.
- [x] Reserved concurrency as a **spend** ceiling, not a capacity plan — the
      Function URL is unauthenticated and every route behind it costs OpenAI and
      Gemini credits, so an uncapped function bills without limit if the URL
      leaks. dev = 5 (applied), prod = 50 (config only; prod has never been
      applied — state contains `fridgeezy-dev-api` alone).

**Verified against real AWS on 2026-08-03** — this was the open question behind
the whole `lambda.ts` loopback design, and it holds. Chunks surface at the
producer's cadence through the Function URL, not batched at the end:

| Endpoint | Observed |
| --- | --- |
| `/rest/chat` | first byte 1.865s cold, then deltas 30–40ms apart |
| `/rest/suggestions/generate` | cards at 3.18 / 3.62 / 4.21 / 5.01s, `[DONE]` 5.87s |

Test it by timestamping each SSE line (`curl -sN` piped through a read loop) — a
buffered response puts every line at the same offset, a real stream spreads them.

Still open on hosting, neither blocking:

- [ ] **S3 state backend.** State is local, so the only record of a live
      deployment is one gitignored file on one laptop. `versions.tf:19` has the
      block commented and `infra/README.md` has the bootstrap commands.
- [ ] **Secrets out of Terraform state.** Have the app read SSM at cold start
      instead of Terraform baking values into env vars. `iam.tf` already grants
      the permission, so this is app-side only — and it should land *before* the
      state file moves to S3.
- [ ] **Auth on the Function URL.** `AuthType: NONE` in both environments; the
      concurrency cap bounds the damage but does not prevent it. Switch to
      `AWS_IAM` once the client can sign requests.

---

## Phase 4 — Embeddings migration (corpus-wide — easy to miss)

> **Recommended to CUT, 2026-08-06.** This is the weakest item on the list and
> the most expensive. Phase 0 already established that matching dimensions
> (Cohere Embed v4 at 1536) avoids the *schema* change but **not the re-embed** —
> the vector spaces differ, so the whole corpus goes back through the model, and
> the 10 `vector(3072)` columns need migrating either way. Against that:
> embeddings are the one place OpenAI is meaningfully cheaper, the corpus is small
> enough that either bill is trivial, and stored vectors must be built by the same
> code as query vectors — so `buildSuggestionSignature` and `embed-suggestions`
> have to move together or similarity silently degrades rather than erroring.
>
> The only benefit is dropping the OpenAI key — and **embeddings are now the ONLY
> thing holding it.** Chat and ingredient extraction are both ported, so this
> phase is no longer one of several blockers, it is the last one.
>
> That cuts both ways and the tension is worth stating plainly: cutting Phase 4
> means `OPENAI_API_KEY` stays a hard boot requirement forever, so the "one
> credential, one bill" benefit that motivates the whole Bedrock migration is
> unreachable. Either accept that the migration buys only *text inference* on IAM
> and the AWS bill, or reverse this and do the corpus re-embed. Do not carry both
> positions at once.

Switching off `text-embedding-3-small` changes vector dimensions, so this is a
data migration, not just a code edit.

- [ ] Confirm the new embedding model's dimension vs the current pgvector column.
- [ ] Migrate the pgvector column dimension (new column or table).
- [ ] **Re-embed the entire recipe/ingredient corpus** with the new model and
      backfill.
- [ ] Update `use-find-recipes` / FTS+vector search paths to the new column.
- [ ] Validate recommendation quality against the old embeddings before dropping
      the old column.

---

## Phase 5 — Observability, cost, cutover

- [x] Add per-request token + latency logging (2026-08-06). `reportUsage` in
      `libs/llm` emits one `[LLM] {...}` JSON line per model call, from *both*
      providers and both entry points (`generateStream`, `generateCompletion`),
      carrying `provider`, `model`, `label`, `inputTokens`, `cachedInputTokens`,
      `outputTokens`, `latencyMs` and `streamed`.
      **It lives in the facade, not at the call sites.** That is what makes the
      two providers comparable at all — the counts are normalised to one shape
      regardless of which SDK produced them (OpenAI reports
      `prompt_tokens`/`completion_tokens` with hits folded into the prompt total;
      Anthropic reports `input_tokens`/`output_tokens` with the cache split
      disjoint), and a new call site is instrumented by construction.
      **`label` is set at all 12 call sites and matters more under Bedrock**,
      where every path runs the same `BEDROCK_MODEL_ID` and the model field stops
      distinguishing them.
      Two provider-specific details worth keeping: OpenAI streaming reports no
      usage at all without `stream_options: { include_usage: true }`, and it
      arrives as a final chunk with an EMPTY `choices` array — safe only because
      `processJsonlStream` reads `choices[0]?.delta?.content` and skips falsy
      content. On Bedrock the counts arrive split across `message_start` (input)
      and the final `message_delta` (output), so `toCompletionChunks` accumulates
      and fires `onUsage` once at the end.
      Query it with CloudWatch Logs Insights:
      `filter @message like /\[LLM\]/ | stats sum(inputTokens), sum(cachedInputTokens), sum(outputTokens), avg(latencyMs) by label, provider`
- [x] **Fix the cache-hostile prompts** (2026-08-06). Prompt caching is a *prefix*
      match on both providers — automatic on OpenAI, explicit `cache_control` on
      Anthropic — so anything volatile placed early invalidates everything behind
      it, silently and at full price.
      `buildRecipeSystemPrompt` (`generate-recipe.ts`) and `buildSystemPrompt`
      (`promote.ts`) both interpolated `ingredientNames` — the one thing that
      changes on every request — at **line 3**, ahead of the units table, tag
      list, category guide, tagging/duration rules and the whole output format.
      The two largest prompts in the app cached nothing. Both blocks moved to the
      end; verified as a pure reorder (no prompt line added or removed).
      Measured on `gpt-4o-mini` with a 3.8k-token prefix: first call 3832 input /
      0 cached, identical repeat **120 input / 3712 cached** — 97% of the prompt
      off full rate, on the streamed path too.
      **`step-structure.eval.ts` needs re-running to re-baseline** — it measures
      exactly the constraint that moved.
      Deliberately NOT changed: `buildSuggestionsSystemPrompt(count)` interpolates
      `count` in line 1, but the main pass always passes `SUGGESTIONS_PER_BATCH`,
      so ~90% of calls share a prefix and only the rare top-up diverges. Not worth
      a prompt change. `escalate-difficulty`'s two difficulty strings are likewise
      low-cardinality (at most 6 prefixes) and cache per-combination.
- [x] **Prompt caching on the Bedrock branch** (2026-08-06). The two providers do
      not meet in the middle: OpenAI caches prefixes automatically — which is why
      the `buildRecipeSystemPrompt` reorder paid off with no further code — while
      Anthropic requires **explicit `cache_control` breakpoints** and Bedrock does
      not offer the automatic kind at all. Without this, flipping
      `LLM_PROVIDER=bedrock` lost every cache hit the OpenAI branch gets free, so
      any cost comparison would have measured Bedrock at its worst.
      `buildParams` now sends `system` as a content block carrying
      `cache_control: {type: "ephemeral"}` instead of a bare string. **One
      breakpoint is all there is to place:** render order is
      `tools` → `system` → `messages`, this client sends no tools, and the user
      turn is per-request by definition — so the end of `system` is the end of
      everything cacheable, and the other three breakpoints the API allows have
      nothing to mark.
      **5-minute TTL over the 1-hour one**, deliberately: the hour doubles the
      write premium and needs three reads rather than two to break even, which
      suits steady traffic. This runs on Lambda behind bursty session-shaped
      usage — a batch's calls land seconds apart, the next batch may be hours off.
      Covered offline by `check-streaming-conformance` (50 assertions, up from
      45): the breakpoint is on the system block, the text survives the wrapping,
      the **user turn carries none**, and a call with no system omits the field
      rather than sending an empty block. Confirmed to fail when it should —
      reverting to the bare string turns 3 red.
      **A prefix below the model's minimum silently does not cache** (1024 tokens
      on Sonnet 4.6/5, 512 on Opus 5, 4096 on Opus 4.6 and Haiku 4.5) — no error,
      and no write either, so marking the short adjudicator prompts costs nothing
      and simply does nothing on most models.
- [ ] Set a cost baseline: compare Bedrock token spend + Lambda compute vs the
      current OpenAI + Gemini bill on representative volume. **The logging above
      is the input to this** — read real `[LLM]` totals per `label` rather than
      estimating from prompt length, and note that Bedrock is priced separately
      from the first-party Anthropic API. Half of this is measurable today: the
      OpenAI side needs no account access.
- [ ] Roll out behind the provider flag: shadow / percentage cutover, watch eval
      scores and error rates, keep OpenAI as instant rollback.
- [ ] Decommission OpenAI paths once Bedrock is stable and validated.
- [ ] Update `CLAUDE.md` (backend) — the Overview/Routing sections now describe the
      current Express + OpenAI setup; document the Bedrock + Lambda architecture
      once it lands.

---

## Explicitly out of scope / defer

- Moving images off Gemini (keep unless a reason emerges — see Phase 0).
- Any prompt rewrite beyond what evals prove is needed for the model swap.
- Multi-region / HA — single region first.
- **Bedrock Guardrails.** Evaluated 2026-08-06, not worth adopting here, and not
  a reason to move inference either way — it has a standalone `ApplyGuardrail`
  API, so it is callable against arbitrary text without invoking a Bedrock model.
  Feature by feature: contextual grounding is strictly worse than what
  `verifySuggestionAuthenticity` already does (a generic grounding check would
  never catch a ceviche with no seafood); PII redaction has no subject matter
  here; denied-topics would stop `/rest/chat` being used as a free
  general-purpose LLM, but the actual fix for that is **auth on the Function
  URL** — already open under Phase 3 — and a content filter treats the symptom
  while still billing for every filtered request; image content filtering is
  already handled at the model layer by both providers.
- Bedrock Knowledge Bases, Agents, and Model Evaluation. Each has a
  purpose-built in-repo equivalent that fits better: pgvector with custom text
  builders, `usecases/`, and the eval harnesses respectively.

### Alternative NOT evaluated when this file was written

**Claude Platform on AWS** — Anthropic-operated rather than partner-operated,
reached through AWS infrastructure with SigV4 auth, IAM access control and AWS
Marketplace billing, at same-day feature parity with the first-party API. Bare
model IDs (no `anthropic.` prefix, no inference profiles), an `AnthropicAWS`
client, and a required `workspace_id`.

Worth probing before committing to Bedrock, because it delivers the three things
actually motivating this migration — IAM instead of an API key, one AWS bill,
in-region inference — **without** Bedrock's feature subset, which drops Message
Batches, the Files and Models APIs, and every server-side tool. `libs/bedrock` is
one client construction and two response transforms, and `libs/llm` already
resolves providers by name, so evaluating it is roughly a day. It carries its own
entitlement question, which may or may not be easier than the one currently
blocking Bedrock.

---

# Scope: food only — done 2026-08-06

Drinks are out of scope and are now gated. Two enforcement points, deliberately:
`FOOD_ONLY_RULE` (`constraint-rules.ts`, shared by the batch, single and compose
generators) as the cheap first line, and a `not_food` status on
`verifySuggestionAuthenticity` as the actual gate. Covered by `DRINKS` and
`FOOD_WITH_DRINK` in `dedup-authenticity.eval.ts` — 24/24 passing, with the
pre-existing `GUTTED_DISHES` and invention fixtures unregressed.

**The axis is "is its purpose to be drunk", not "does it contain alcohol",** and
that was a deliberate call rather than a convenient one. Alcohol as an *ingredient*
is fine and must stay fine — coq au vin, tiramisu, beer-battered fish — while a
virgin daiquiri is as out of scope as the original. Cutting on alcohol instead
would have stripped wine and beer out of a large slice of European cooking while
still admitting smoothies.

- [x] **Client copy for the rejection** (2026-08-06). `useSuggestionFeed` returns
      `rejectedReason: "not_food" | null`, `generateMore` is a no-op while it is
      set, and `search-screen.tsx` derives a third empty state from it
      (`browseEmpty`) — "No drinks, just food", with a `glass-cocktail-off` glyph
      tinted `onBackgroundVariant` rather than `error`, because nothing went
      wrong. Verified on the simulator by forcing the branch; the copy wraps over
      three lines with no clipping.
      **The wording lives in the client and the backend sends a code, never a
      sentence.** There is no i18n library in the client today, so "so it can be
      localised" is aspirational — the live reason is that copy in a packed
      tarball cannot be changed without rebuilding it.

Still open, both product decisions rather than bugs:

- [ ] **Give the feed a free-text path, or accept the state is defensive.** The
      empty state above is currently **unreachable on that screen**: the AI feed
      is driven entirely by structured filters (fridge ingredients, course,
      cuisine, difficulty), and typing tears it down in favour of a catalogue-only
      `ilike` search (`aiEnabled = shouldUseAI && !isSearching`). A drinks-only
      request cannot be expressed there. The user-facing path that CAN ask for a
      mojito is **chat**, which drops the dish and lets the assistant explain
      itself in prose. So the value delivered today is the database protection —
      no drinks persisted or mislabelled, on every path — and the empty state is
      there for the day free text reaches the feed.
- [ ] **Decide whether drinks ever get a home.** If smoothies and lassi are wanted
      later, the taxonomy needs a `drink` course tag and a `dish_form` value
      before the gate can be narrowed to alcohol — a migration plus a seed change,
      not a prompt edit. Until then "anything drunk" is the honest line, because
      the tag vocabulary cannot represent a beverage.

## App Store note

Alcohol does not block release — the relevant rule prohibits *encouraging
excessive consumption*, not recipes containing it — but it does move the age
rating, and **generated content has to be rated for what it CAN produce, not what
it was designed to produce**. Before this gate a reviewer could type "mojito" and
get a cocktail, which makes the app one that teaches you to make alcoholic drinks
regardless of intent. The gate is what makes "this app does not produce cocktail
recipes" a property of the system rather than a hope about the model.

Note that food recipes still reference alcohol as an ingredient, so the mild tier
applies either way; rejecting drinks does not get you to "no alcohol references"
and chasing that is not worth breaking real dishes for. **Walk the current
App Store Connect questionnaire before declaring a rating** — the tiers were
revised recently and under-declaring is enforced after the fact.

---

# Auth — unrelated to the migration above

Kept in this file because it is the repo's TODO list, not because it belongs to
the Lambda/Bedrock work. Nothing here is started.

**First, the thing that makes both items confusing:** `supabase/config.toml`
`[auth]` configures the **local** stack only. The hosted project's auth is
configured in the Supabase dashboard and does *not* read this file, so a setting
can be correct locally and absent in production with nothing to flag the drift.
(Newer CLI versions can push config; this repo's pinned 2.72.2 predates relying
on that.) Treat every item below as two pieces of work — local `config.toml`
and the dashboard — until that changes.

## Email confirmations

`enable_confirmations = false` (`config.toml:203`). Sign-up returns a session
immediately with no verified email, which is deliberate and right for local:
there is no real inbox, and anything sent lands in Mailpit on `:54324`.

It means the address on an account is **unverified** — nobody has proven they
own it — so anything built on "the user's email" (password reset, transactional
mail, account recovery, support identity) rests on nothing until this changes.

- [ ] Turn confirmations on for the hosted project (dashboard).
- [ ] Configure SMTP — `[auth.email.smtp]` is commented out, and without a real
      sender, enabling confirmations locks people out rather than verifying them.
- [ ] Decide the local story: leaving it `false` locally is fine and convenient,
      but then the confirmation flow is only ever exercised in production. If
      that flow gets non-trivial, enable it locally and read the mail in Mailpit.
- [ ] Check the client handles the unconfirmed state — a sign-up that returns no
      session because confirmation is pending is a different branch from a
      sign-up that returns one, and today only the second exists
      (`features/auth/screens/sign-up/password/password-screen.tsx`).

## OpenID Connect / social sign-in (Google, Apple, …)

Not wired up anywhere: `[auth.external.apple]`, `[auth.external.google]` and
`[auth.external.facebook]` all sit at `enabled = false` (`config.toml:299-325`),
and the client offers email/password only.

- [ ] Pick the providers. **Apple is not optional if any other social login
      ships on iOS** — App Store review requires Sign in with Apple alongside
      third-party sign-in, so "just add Google" is really "add Google and Apple".
- [ ] Provider setup: OAuth client IDs, and secrets via env substitution —
      `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"` is the pattern
      already in the file. Secrets never go in `config.toml`.
- [ ] Redirect handling. The app's scheme is `fridgeezy` (`app.json`), so the
      callback is `fridgeezy://…` and must be added to
      `additional_redirect_urls` locally **and** to the dashboard's allow-list.
      `site_url` is still the CLI default `http://127.0.0.1:3000`.
- [ ] `skip_nonce_check` — the comment in `config.toml` notes it is required for
      local Google sign-in. Set it locally only; never in the hosted project.
- [ ] Account linking. `enable_manual_linking = false` today, so a user who signs
      up with email and later uses Google with the same address gets a **second
      account**, silently. Decide the policy before shipping the first provider,
      because retrofitting a merge across existing rows is far worse than
      choosing up front.
- [ ] Client UI + the `signInWithOAuth` flow, which needs an in-app browser
      session rather than the current password screens.
