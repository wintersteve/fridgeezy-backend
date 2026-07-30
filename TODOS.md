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
- **Stateful MCP sessions don't fit Lambda.** `/mcp` uses `mcp-session-id`
  (`apps/api/src/express-app.ts` allows the header; the MCP SDK transport holds
  session state in-process). Lambda invocations are stateless — session state
  needs an external store or a stateless transport. See Phase 2.
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

- [ ] **Pick the Bedrock text model.** Recommendation: Claude on Bedrock
      (`anthropic.claude-*`) for the accuracy-critical structured generation
      (suggestions, recipes) — strongest instruction-following for the strict
      JSONL + tagging rules. Consider Amazon Nova (Lite/Micro) only for cheaper,
      lower-stakes paths *after* it passes evals.
- [ ] **Pick the vision model** for ingredient extraction (Claude on Bedrock
      supports image input).
- [ ] **Decide embeddings target** (Titan Text Embeddings v2 or Cohere on
      Bedrock) — note dimension change (Phase 4).
- [ ] **Decide image model.** Bedrock has no drop-in for the Gemini illustration
      style. Options: (a) keep Gemini as-is (simplest — images aren't the
      migration's point), or (b) move to Nova Canvas / Titan Image and re-tune
      the prompt in `create-recipe-image.ts`. Recommend (a) for now.
- [ ] **Build an eval harness** for authenticity + structure adherence: a fixed
      set of inputs, run through both the OpenAI baseline and each Bedrock
      candidate, score on (real dish? all core ingredients present? exactly 1
      component/cuisine/course tag? valid JSONL? nutrition non-zero?). This is
      the gate for the whole inference migration.
- [ ] Choose AWS region (must serve the chosen Bedrock models) and request model
      access in the Bedrock console.

---

## Phase 1 — Bedrock inference swap (model layer only, still on Express)

Ship this while still running the existing Express server locally, so the model
change is validated in isolation before touching hosting.

- [ ] Add a Bedrock client lib (mirror `libs/openai` / `libs/genai` shape).
      Use the **`AnthropicBedrockMantle`** client from `@anthropic-ai/bedrock-sdk`
      for Claude; Bedrock model IDs take the `anthropic.` prefix
      (e.g. `anthropic.claude-*`). Region required; auth via AWS credential chain
      (IAM role in Lambda, profile locally).
- [ ] Introduce a thin **provider abstraction** so call sites don't hard-code the
      SDK — one `generateStream(...)` that yields text deltas. This keeps
      `processJsonlStream` unchanged (it accumulates a text stream and doesn't
      care about the provider) and lets you A/B OpenAI vs Bedrock behind a flag.
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

## Phase 2 — MCP session state (unblock Lambda)

- [ ] Audit whether `/mcp` genuinely needs cross-request session state or can run
      **stateless** per request. Prefer stateless if the client flow allows it —
      it removes this whole problem.
- [ ] If sessions are required: externalize `mcp-session-id` state to DynamoDB
      (or ElastiCache) so any Lambda invocation can rehydrate it.
- [ ] Confirm the MCP SDK transport (`@modelcontextprotocol/sdk`) supports the
      stateless / external-store mode you pick; adapt `mcp.controller.ts` /
      `mcp.routes.ts` accordingly.

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
- [ ] IAM role for the function: `bedrock:InvokeModel` /
      `bedrock:InvokeModelWithResponseStream`, Supabase access (via env), the MCP
      session store, and S3/Supabase storage for images.
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
- [ ] Update `CLAUDE.md` (backend) — the Overview still describes the OpenAI
      Agents SDK + local MCP server; document the Bedrock + Lambda architecture.

---

## Explicitly out of scope / defer

- Moving images off Gemini (keep unless a reason emerges — see Phase 0).
- Any prompt rewrite beyond what evals prove is needed for the model swap.
- Multi-region / HA — single region first.
