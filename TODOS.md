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
      `ModelSelection` already handles model IDs. **The Bedrock caps are unset and
      unvalidated** — they fall back to `BEDROCK_MAX_TOKENS` (16k), which is far
      too generous for a 10-token verdict and needs a real number once access
      lands.
      **The `client?: OpenAI` seam is gone**, replaced by an optional `provider`.
      It could only ever inject an OpenAI client, so it could not express the A/B
      it existed for; nothing passed one. That also resolves the previous
      checkbox's blocker: `streamSingleSuggestion`'s reveal loop is now the
      exported `accumulateSuggestionReveals`, and the conformance check drives
      **that function** instead of a verbatim copy — 20/20 still pass, with
      identical reveal counts, so the collapse changed no behaviour.
      **`OPENAI_API_KEY` is still required to boot.** The lazy imports in
      `@fridgeezy/llm` remove it from every path it covers, but chat, ingredient
      extraction and the embedding call sites still import `libs/openai` at top
      level, and it throws at import. A Bedrock-only Lambda needs the next two
      checkboxes plus Phase 4 first.
- [ ] Port the **vision** path (ingredient extraction) to the Bedrock vision model.
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
- [ ] IAM role for the function: `bedrock:InvokeModel` /
      `bedrock:InvokeModelWithResponseStream`, Supabase access (via env), and
      S3/Supabase storage for images.
- [ ] Port env/config: `GOOGLE_API_KEY` (if keeping Gemini), Supabase keys,
      `GENAI_IMAGE_MODEL`, region, Bedrock model IDs. Move secrets to SSM
      Parameter Store / Secrets Manager (no `dotenv` in Lambda).
- [x] IaC: **Terraform**, checked in at [`infra/`](infra/README.md). Defines the
      function, Function URL (`RESPONSE_STREAM`), IAM (logs + Bedrock + SSM),
      log group, and per-environment tfvars. Still open: the session store
      (blocked on Phase 2) and the S3 state backend (state is local today).
- [ ] Set `max` timeout headroom for the longest stream (recipe generation) and a
      sane memory size; measure cold-start latency on the SSE paths.

---

## Phase 4 — Embeddings migration (corpus-wide — easy to miss)

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

- [ ] Add per-request token + latency logging (Bedrock usage) to track cost and
      the idle-wait profile on Lambda.
- [ ] Set a cost baseline: compare Bedrock token spend + Lambda compute vs the
      current OpenAI + Gemini bill on representative volume.
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
