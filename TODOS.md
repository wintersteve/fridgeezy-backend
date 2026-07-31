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
| Chat / recipe-chat | `chat.schema.ts` default `gpt-4o` | `gpt-4o` |
| Ingredient extraction (vision) | `apps/api/src/modules/ingredients/usecases/extract-ingredients/extract-ingredients.ts` | `gpt-4o` |
| Embeddings | `libs/openai/src/lib/modules/embeddings/*` | `text-embedding-3-small` |
| Recipe images | `libs/genai/*` | `gemini-2.5-flash-image` |

Shared streaming plumbing that must keep working regardless of provider:
`processJsonlStream` + `extractStableJsonFields` (`libs/streaming-server`,
`apps/api/src/modules/suggestions/services/extract-stable-json-fields.ts`).

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
- [ ] Port the streaming shape: OpenAI `chat.completions.create({stream:true})`
      → Bedrock/Anthropic Messages streaming. Feed the text deltas
      (`content_block_delta` / `text_delta`) into the existing JSONL parser.
      Verify `extractStableJsonFields` still reveals fields incrementally.
- [ ] Swap each text call site (table above) behind the flag. Keep system/user
      prompts **byte-identical** at first — change only the transport — so the
      eval isolates model behavior from prompt changes.
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

- [ ] Wrap the app for Lambda. Two options:
      (a) keep Express behind an adapter, or (b) split the SSE endpoints
      (`/suggestions`, `/recipes`, `/chat`) into dedicated streaming
      handlers. Note `express-app.ts` deliberately skips `express.json()` and
      reads the raw stream — preserve that raw-body handling.
- [ ] Use **Lambda response streaming** (`awslambda.streamifyResponse`) via a
      **Function URL** (or ALB). **Do not** front the streaming endpoints with
      API Gateway — it buffers and breaks SSE.
- [ ] Keep the parallel fire-and-forget image generation
      (`generateAndUploadRecipeImage`, kicked off in `generate-recipe.ts`)
      working — verify it isn't killed when the response stream closes (Lambda
      freezes the execution context after the response ends; a fire-and-forget
      promise may not complete). May need to `await` it or move image gen to a
      separate async invocation / queue.
- [ ] IAM role for the function: `bedrock:InvokeModel` /
      `bedrock:InvokeModelWithResponseStream`, Supabase access (via env), and
      S3/Supabase storage for images.
- [ ] Port env/config: `GOOGLE_API_KEY` (if keeping Gemini), Supabase keys,
      `GENAI_IMAGE_MODEL`, region, Bedrock model IDs. Move secrets to SSM
      Parameter Store / Secrets Manager (no `dotenv` in Lambda).
- [ ] IaC: define the function, Function URL, IAM, and session store (SAM / CDK /
      Terraform — pick one and check it in). There are no deploy artifacts in the
      repo today.
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
