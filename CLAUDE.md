# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"fridgeezy-backend" is an Nx monorepo (TypeScript, npm workspaces) that powers the
Fridgeezy React Native app's AI features — recipe suggestions, generation,
composition, modification, difficulty escalation, chat, and ingredient extraction
from photos. It also owns the Supabase database: migrations, seeds, embeddings,
and the generated types both repos share.

The API is Express, served locally on port 8000 and deployed to AWS Lambda. Routes
live under `/rest`; most stream their responses over SSE.

## The client repo — always check it

The React Native client lives at **`/Users/steve/Projects/fridgeezy`** (GitHub:
`wintersteve/fridgeezy`). It is a separate repo but it is *not* independent:

- It consumes `@fridgeezy/schemas` and `@fridgeezy/types` as `file:` tarballs
  built from `libs/schemas` and `libs/types` in this repo. The client **commits**
  those tarballs at `vendor/fridgeezy-<lib>.tgz` and pins
  `file:vendor/fridgeezy-<lib>.tgz` — it does *not* reference a path into this
  repo. That was tried and abandoned: a `file:../../WebstormProjects/...` pin
  resolves on one laptop and fails on EAS Build and any CI runner, which only
  get what is in git. See that repo's `vendor/README.md` for the refresh steps.
- Its `src/shared/api/ai` hooks call the `/rest` endpoints directly, and
  `src/shared/api/streaming` parses the SSE frames field-by-field as they arrive.

**Before finishing any change to a shared schema, a database type, an endpoint
path, a request/response shape, or an SSE frame shape, read the corresponding
client code** (`/Users/steve/Projects/fridgeezy/src/shared/api/`, and that repo's
own `CLAUDE.md`). A change that only compiles here still breaks the app: the
client pins a built tarball, so schema edits do not reach it until the lib is
rebuilt, packed, and reinstalled there.

**Nothing in this repo automates that.** There is no `pack` target — the refresh
is `nx run-many -t build` here, then `npm pack` per lib, then copy into the
client's `vendor/` and `npm install` **naming each dep explicitly**. A bare
`npm install` does not pick up a changed tarball: the path is unchanged, so npm
resolves from cache and silently keeps the old copy. Treat the client refresh as
a manual step you have to remember, not something a build will do for you.

## Commands

```bash
npm run api            # nx run api:serve — Express on http://localhost:8000
npm run build:all      # nx run-many -t build --all
npm run build:shared   # build only tag:scope:shared libs
npm run lint:all
npm run knip           # dead files, exports and dependencies

npx nx run @fridgeezy/api:build
npx tsc --noEmit -p apps/api/tsconfig.app.json    # type check the API
```

Database (`apps/database`, all `npx nx run @fridgeezy/database:<target>`):

- `start` / `stop` / `status` — the **local** Docker stack (see below)
- `reset` — `supabase db reset` against **local**
- `types` — regenerate `database.types.ts` + entity types from **local**
- `up-remote` / `reset-remote` — the `--linked` versions, against the live dev
  project
- `types-remote` — generate types from the linked project instead
- `embed-ingredients|embed-categories|embed-units|embed-tags|embed-suggestions|embed-recipes`
  — all six run one script, `operations/generate-embeddings.ts <target>`. They
  backfill only rows missing a vector; append `-- --all` to re-embed everything,
  which is what you want after changing a text builder. `embed-ingredients` is
  the one to reach for after any bulk import: `seed-ingredients` embeds only the
  rows it creates, so anything the LLM added arrives without a vector and stays
  invisible to similarity matching until this runs.
- `seed-ingredients`, `generate-ingredient-seed`, `generate-category-images`
- `backfill-course-tags` — one-off repair, already run on 2026-08-02. Fills a
  course tag on suggestions and recipes that have none, classifying each dish
  with an LLM. Dry run unless `COURSE_APPLY=true`; idempotent, so it is safe
  to re-run — rows that already carry a course are skipped.
- `dedupe-ingredients` — an audit, not routine. Nothing calls it; run it only
  when the catalog visibly holds two names for one thing ("scallion" /
  "green onion"). Dry run unless `DEDUP_APPLY=true`, and it costs ~5N LLM calls.

### Local Supabase is the default for development

`apps/api/.env` and `apps/database/.env` both point at the **local** stack, with
the remote values commented directly beneath. Develop against local; switch to
remote only for a deliberate remote operation, and switch back after.

The reason is blast radius, not convenience. Every script in `operations/` writes
to whatever `SUPABASE_URL` says, and the remote dev project is the **same
database the deployed Lambda serves** — there is no separate staging. A stray
`seed-ingredients`, `embed-* -- --all` or `reset-remote` against it is a
production incident. Pointed at local, the worst case is rebuilding a database
that `reset` rebuilds in a minute.

That is also why the target names are shaped the way they are: the short,
easy-to-type ones (`reset`, `types`) are **local**, and reaching the live project
takes a deliberately longer name (`reset-remote`, `up-remote`, `types-remote`).
`up` no longer exists — it used to mean `migration up --linked`, so a leftover
muscle-memory `up` now fails loudly instead of quietly migrating the live project.

Bringing a local stack up from nothing:

```bash
npx nx run @fridgeezy/database:start     # Docker must be running
npx nx run @fridgeezy/database:reset     # 17 migrations + 6 seeds
npx nx run @fridgeezy/database:embed-categories
npx nx run @fridgeezy/database:embed-units
npx nx run @fridgeezy/database:embed-tags
```

**The three `embed-*` runs are not optional.** The seeds insert categories, units
and tags as plain rows with no vectors, and ingredient matching resolves a
category by vector search — so on a freshly reset database every suggestion dies
with `No categories found - ensure category embeddings are populated`, surfacing
to the client as cards that appear and are immediately withdrawn. They cost a
fraction of a cent (265 short rows through text-embedding-3-small).

Optionally `seed-ingredients` then `embed-ingredients` for a realistic ingredient
catalog. Without it the pipeline still works — unmatched ingredients are simply
created on the fly — but every dish pays LLM adjudication for ingredients a
seeded catalog would have matched outright.

Local keys are the CLI's fixed values, identical on every machine and not
secrets: URL `http://127.0.0.1:54321`, Studio on `:54323`, Postgres on `:54322`.
This CLI version issues `sb_publishable_…` / `sb_secret_…` rather than the legacy
anon/service-role JWTs; supabase-js ≥ 2.90 accepts both, and they still go in the
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` variables.

### Writing the .env files

Don't hand-edit the Supabase trio — `env-local` / `env-remote` derive it:

```bash
npx nx run @fridgeezy/database:env-local              # LAN IP (device default)
npx nx run @fridgeezy/database:env-local -- --simulator   # 127.0.0.1
npx nx run @fridgeezy/database:env-remote            # from SSM
```

Both rewrite `apps/api/.env` and `apps/database/.env` **in place, touching only
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`** — your LLM
keys, `SUPABASE_PROJECT_ID`, comments and commented-out blocks all survive, so
it is safe to re-run and needs no AWS credentials in local mode.

Nothing is templated. Local values come from `supabase status -o json` and
remote ones from SSM, which `infra/put-secrets.sh` already treats as the source
of truth for the deployed function — so a CLI upgrade that changes the key
format (this one moved off anon JWTs) flows through instead of leaving a stale
literal behind, and no remote secret has to live in a committed file. The remote
mode reads the Function URL from `terraform output` for the same reason.

The client is a **separate repo**, so its four `EXPO_PUBLIC_*` lines are printed
to stdout to paste rather than written — a hardcoded cross-repo path is exactly
what breaks on someone else's machine.

`--simulator` exists because the default is the LAN IP: on a physical device
`localhost` means *the device*, so loopback reaches nothing and every request
fails with a bare "could not connect". On a simulator loopback is both fine and
more stable, since it survives the router handing out a new lease.

After changing the client's `.env`, restart Expo with `npx expo start --clear` —
`EXPO_PUBLIC_*` values are inlined at build time, so a running Metro keeps
serving the old ones however many times you edit the file.

Two things that will waste your time otherwise:

- **A running API server does not pick up an `.env` change.** `nx serve` dedupes,
  so a second `npm run api` attaches to the existing process rather than starting
  a fresh one — it prints "Waiting for @fridgeezy/api:serve:development in
  another nx process" and you end up testing the old configuration. Restart the
  server itself, or run `PORT=8001 node apps/api/dist/main.js` for a throwaway
  instance on another port.
- **Stale stacks squat on the ports.** A pre-`apps/database/` layout stack still
  exists under project id `src` and Docker Desktop restarts it on launch, which
  fails our `start` with `Bind for 0.0.0.0:54322 failed`. Clear it with
  `npx supabase stop --project-id src`.

### Embeddings: one model, and why 1536 dimensions

Every vector column in this database is **`text-embedding-3-small` (1536d)**,
and every `search_*` function takes a **precomputed** vector — Postgres makes no
outbound HTTP calls (the old in-DB `generate_embedding`, which called OpenAI
through the `http` extension from inside a query, is gone).

The dimension is not a preference, it is a **hard pgvector limit**: HNSW and
IVFFlat cannot index above 2000 dims. A 3072-dim column (`text-embedding-3-large`)
is therefore un-indexable and every search over it is a sequential scan — the
recipe index was literally commented out for this reason before the migration to
1536. Anything larger than 2000 dims silently costs you every vector index in the
schema, so **an embedding model that emits more than 1536 dims is not a candidate
here** regardless of its quality scores. This is also why `TODOS.md` picks Cohere
Embed v4 for the Bedrock migration: it emits 1536, so the columns stay as they are.

Changing the model at all means migrating column dimensions and re-embedding the
whole corpus — the `embed-*` targets with `-- --all`. The same applies to a change
in any *text builder*: stored vectors must be built by the same code as the query
vectors, or they stop being comparable and similarity silently degrades rather
than erroring. Dish signatures are the live case — `buildSuggestionSignature` in
the API and `embed-suggestions` must agree.

Scripts sit in two directories, and the split is a safety boundary — the names
say which is which:

- `apps/database/operations/` — **acts on the live database or storage**, and
  most cost money: seeding, embeddings, category images, the dedupe audit.
- `apps/database/codegen/` — **regenerates source files in this repo**:
  `generate-types` (Supabase → `database.types.ts`) and `generate-entity-types`
  (that file → the `entities/` wrappers). Deterministic, no production effects.

Put a new script on the correct side — it is the difference between "safe to run
any time" and "this writes to prod". These were `src/scripts/` and `tools/`,
which carried none of that meaning and left the distinction living only in this
file; `src/` was actively misleading, since this project's real artifacts are the
SQL under `supabase/`.

The `supabase` CLI is pinned to an **exact** version (2.72.2), not a caret range,
because its destructive commands differ across versions. On 2.72.2 `db reset`
seeds by default and offers `--no-seed` to opt out; on 2.111 the docs describe
`--include-seed`, i.e. the opposite default. Under `^2.67.3` a fresh install
picked up whichever was current, so the same `db reset --linked` either seeded or
did not depending on the day. Before upgrading, re-read `db reset --help` and
adjust the `reset` target to match — do not assume the flags carried over.

Run the Supabase CLI from **`apps/database/`**, not `apps/database/src/` — every
`database` target sets `cwd` there. The CLI looks for a `supabase/` directory
below its working directory, so the files themselves live one level further down,
in **`apps/database/supabase/`** (`config.toml`, `migrations/`, `seeds/`).

Those two must stay in step: when the cwd and the `supabase/` directory diverged,
`db dump`, `migration repair` and `migration list` all failed in ways that looked
unrelated, and `migration list` reported an empty Local column while happily
connecting.

Seeds run in glob order (`./seeds/*.sql`), so the numeric prefixes are load
order, not decoration — `0021_…` once sorted ahead of `002_…` because `'1'`
precedes `'_'`. Ingredients are **not** seeded by `db reset`; run
`seed-ingredients` after one.

Evals (`npx nx run @fridgeezy/api:<target>`): `eval`, `calibrate`,
`calibrate-ingredients`, `calibrate-authenticity`, `eval-model-migration`,
`check-streaming-conformance`.

### knip

`npm run knip` finds dead files, exports and dependencies. Config in
`knip.json`. Two things it cannot infer on its own, so they are declared there:

- **Entry points Nx knows about but knip does not.** `apps/database`'s scripts
  are invoked by `nx:run-commands` through `jiti`, and the evals by their own
  targets — nothing imports either, so without listing them every one reads as
  dead code.
- **`eslint.base.config.mjs`.** knip's eslint plugin looks for
  `eslint.config.*`; the shared base here has a different name, so every lint
  plugin looked unused until it was added as a root entry.

It reports `apps/api/src/types/*.d.ts` as unused — ambient declarations are
consumed via the global scope, not by import — hence the `ignore` there.

## Layout

```
apps/api          Express API (@fridgeezy/api)
apps/database     Supabase migrations, seeds, embedding + maintenance scripts
infra             Terraform for the Lambda deployment
libs/schemas      Zod v4 request/response schemas — packed for the client
libs/types        Generated database.types.ts + derived entity types — packed for the client
libs/domain       Platform-agnostic domain types, repo interfaces, Result/base-error
libs/supabase     Supabase client + repositories (categories, ingredients, recipes, suggestions, tags, units)
libs/openai       OpenAI client + embeddings
libs/bedrock      Anthropic-on-Bedrock streaming completions
libs/llm          Provider seam: resolveProvider() / generateStream() over openai|bedrock
libs/genai        @google/genai image generation
libs/streaming-server   createStreamHandler, SSE plumbing, CORS, raw-body parsing
libs/toolkit      Canonicalisation helpers (names, ingredient canonical ids, signatures)
```

Nx projects are package.json-based (no `project.json`); workspaces are
`apps/*` and `libs/*`. Libs are tagged `scope:shared`, apps `scope:app`.

`libs/` is **flat**. `schemas`, `types` and `domain` used to sit under
`libs/fridgeezy/`, which looked like it marked the client-facing contracts but
did not: all three carry the same `scope:shared` tag, the boundary rules treat
them identically, and `domain` is not shipped to the client at all — only
`schemas` and `types` are. The nesting cost an extra workspaces glob and enforced
nothing, so it went. If that distinction is ever worth enforcing, use a tag
(`scope:published`) and a boundary rule — a directory is a convention people
drift from, a tag is checkable.

### Entry points

`create-app.ts` assembles the Express app (`app.use("/rest", createRestRouter())`)
and is shared by two entry points so both serve identical routes:

- `main.ts` — local server, listens on `PORT` (default 8000).
- `lambda.ts` — binds the app to a loopback port once per execution environment
  and proxies each invocation to it over a real HTTP request, streaming the
  response back. The real-socket hop is deliberate: `express-app.ts` omits
  `express.json()` because handlers read the raw request stream themselves.

`background-tasks.ts` tracks deliberately-unawaited work (recipe image
generation, kicked off as soon as the dish name is known). `lambda.ts` drains
it after the response closes — on Lambda a floating promise would otherwise be
frozen mid-flight.

### Routing

`createRestRouter` (`apps/api/src/rest`) mounts the feature modules from a
`MOUNTS` array; the startup banner is *derived* from that same array, so adding a
route needs no second edit.

It used to live at `apps/api/src/api/v1/rest` — three directories holding two
files, one of which only re-exported the other, with a `v1` that appeared in no
URL. The mount is `app.use("/rest", …)`, so a real v2 would have to change the
mount path anyway; the nesting only made every import inside it `../../../`.

| Endpoint | Module |
| --- | --- |
| `POST /rest/ingredients/extract` | `modules/ingredients` |
| `POST /rest/suggestions/generate` | `modules/suggestions` |
| `POST /rest/suggestions/:id/promote` | `modules/suggestions` |
| `POST /rest/recipes/generate` | `modules/recipes` |
| `POST /rest/recipes/difficulty/escalate` | `modules/recipes` |
| `POST /rest/recipes/modify` | `modules/recipes` |
| `POST /rest/recipes/:recipeId/compose` | `modules/recipes` |
| `POST /rest/recipes/:recipeId/chat` | `modules/recipes` |
| `POST /rest/substitutes/generate` | `modules/substitutes` |
| `POST /rest/chat` | `modules/chat` |
| `GET /rest/health` | direct |

`/substitutes/generate` streams one frame per requested missing ingredient, in
request order — the client sizes its loading skeletons by slicing its own request
list and keys cards on `ingredientName`, so the service buffers out-of-order model
lines, drops duplicates, and fills any ingredient the model skipped with a
fallback frame. Substitutes are LLM-generated, not stored: the
`ingredient_substitutes` table was dropped for that reason and does not exist in
the consolidated baseline.

Each module under `apps/api/src/modules/<name>/` owns `<name>.routes.ts`,
`<name>.controller.ts`, `usecases/` (one directory per endpoint), and `services/`
(the reusable steps those use cases compose). Controllers only delegate — the
work lives in the use case.

### Streaming

Use cases build their handler with `createStreamHandler` from
`@fridgeezy/streaming-server`: it validates the body against a request schema,
validates each emitted frame against a response schema (or an array of schemas
for streamed frames), and writes SSE. The client's `use-sse-*` hooks assemble
those frames incrementally, which is why frame shapes are part of the contract.

### LLM providers

- **`@fridgeezy/llm`** is the seam every text call site goes through:
  `resolveProvider()` reads `LLM_PROVIDER` (`openai` | `bedrock`, defaulting to
  `openai` and throwing on anything else), and `generateStream()` /
  `generateCompletion()` dispatch accordingly. **Route new completion call sites
  through here** — never import a provider SDK directly.
- **OpenAI** (`@fridgeezy/openai`) still serves every production request, because
  the default provider is `openai`. Three things bypass the facade and import it
  directly, each still an open checkbox in `TODOS.md`: chat
  (`create-chat-completion.ts`, tool calling), ingredient extraction (image
  input), and embeddings (Phase 4). Because `libs/openai` throws at *import* on a
  missing key, those keep `OPENAI_API_KEY` a hard boot requirement for the API.
- **Bedrock** (`@fridgeezy/bedrock`, `@anthropic-ai/bedrock-sdk`) is reachable
  from every ported call site by setting `LLM_PROVIDER=bedrock`, but **has never
  run end-to-end** — Anthropic models are gated on this AWS account. Its streaming
  translation is covered offline by `check-streaming-conformance`.
- **`@fridgeezy/genai`** (`@google/genai`) generates recipe images.

### Chat tool calling

`apps/api/src/modules/chat/tools` holds tool definitions (zod input/output
schemas + handler). `modules/chat` converts them to OpenAI function-calling
schemas (`convert-tools-to-openai.ts`) and executes the handlers directly — there
is no MCP server or transport in this repo.

They live under `chat` because chat is the only caller. They were briefly their
own top-level `modules/ai`, which broke the convention every other module
follows — routes + controller + usecases + services — by owning no route at all.
If a second consumer ever appears, promoting them back out is the moment to do
it, not before.

### Persistence

`@fridgeezy/supabase` exposes one repository per table; RPC-heavy writes
(`persistWithRelations`, merge functions) live in SQL under
`apps/database/supabase/migrations/`. `@fridgeezy/domain` holds the
platform-agnostic types and repository interfaces those implement.

## Conventions

- DB columns are `snake_case`; TS properties are `camelCase`; SQL function params
  take a `p_` prefix. **LLM output fields are `snake_case`** so they line up with
  the DB and parse straight through the Zod schemas.
- Schemas import from `zod/v4`.
- `libs/types/src/lib/database.types.ts` is generated — regenerate with
  the `types` target rather than hand-editing (a manual edit is fine mid-change,
  but it will be overwritten).

### Adding a column to suggestions/recipes

This crosses many files; missing one silently drops the value. Touch:

- SQL migration (`ALTER TABLE` + the persist functions)
- `database.types.ts` (Row, Insert, Update, Function Args)
- Zod schemas (LLM output, enriched response, recipe DTO) and the compose schemas
- `fetch-enriched-suggestion.ts` (select + mapping), `persist-suggestion.ts`
- `suggestions.repository.ts` / `recipes.repository.ts` (RPC params)
- `create-recipe-stream.ts` (initial state + accumulator), `persist-recipe.ts`
- `create-recipe-image.ts` if it affects image generation
- `fetch-recipe.ts`, `fetch-recipe-summary.ts`
- Use cases: `promote`, `generate-recipe`, `escalate-difficulty`
- `generate-compose-suggestions.ts` (local schema + prompt + persist + yield)
- Then the client: rebuild/pack the schemas + types tarballs and update
  `/Users/steve/Projects/fridgeezy` to consume the new field.

## Data flow: suggestion → recipe

1. The LLM streams suggestions as JSONL, validated by `GenerateSuggestionResponseSchema`.
2. `persistSuggestion()` matches ingredients and tags, then calls
   `suggestionsRepo.persistWithRelations()`.
3. Promotion: `fetchEnrichedSuggestion()` builds a `RecipeStreamInitialState`,
   which seeds the recipe-generation prompt.
4. `createRecipeStream()` accumulates the streamed recipe;
   `persistRecipe()` / `persistRecipeWithIngredientIds()` write it, with image
   generation kicked off as a tracked background task.

### Deliberate gaps in that pipeline

Built and closed 2026-08-03 (`git log RECIPE_QUALITY_PLAN.md` for the full
design). These look like oversights and are not — each was measured, deferred,
and left alone on purpose. Don't "fix" one without the trigger next to it:

- **Dish identity keys off the native name**, not the canonical English one
  (`findSuggestionByName(suggestion.name)`; `name_alt` is display-only). The
  signature embedding catches the cross-name cases instead — Som Tam ≡ Green
  Papaya Salad merges on ingredients. There is no suggestion alias table, so a
  merge drops the alternate name. *Revisit when* alternate names go user-visible.
- **No dish-family (`parent_dish`) link.** Som Tam Thai and Som Tam Lao both
  persist and stay correctly distinct, but as unrelated rows. *Revisit when*
  variants should be grouped in discovery rather than competing for slots.
- **Two ingredient pipelines**: `persist_recipe` (SQL) and `matchIngredients`
  (TS). Only the TS one has the gray-band creation gate, alias learning and LLM
  categories. *Revisit when* a category bug reproduces through recipe
  persistence but not through suggestions — that is this divergence failing.
- **Ingredient names aren't grounded by retrieval** (dish names are, via
  `listCatalogDishes`): the generator free-texts them and `matchIngredients`
  reconciles after the fact. *Revisit when* the `[Ingredients]` logs show the
  gate rejecting or duplicating often.
- **No feature flags.** Dedup and authenticity ship straight to the live path;
  `LLM_PROVIDER` is the only runtime switch. The eval targets are the safety net
  instead. Build a flag scoped to a risky change, not as a standing fixture.

Thresholds (`SIGNATURE_HIGH/LOW_THRESHOLD`, the authenticity confidence floor)
are fitted by the `calibrate*` eval targets. **Re-run the matching target rather
than hand-nudging a constant** — a nudge unfits it from the distribution it was
measured against, and nothing will fail to tell you.
