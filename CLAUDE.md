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
  built from `libs/fridgeezy/schemas` and `libs/fridgeezy/types` in this repo
  (`file:../../WebstormProjects/fridgeezy-backend/libs/fridgeezy/<lib>/dist/*.tgz`).
- Its `src/shared/api/ai` hooks call the `/rest` endpoints directly, and
  `src/shared/api/streaming` parses the SSE frames field-by-field as they arrive.

**Before finishing any change to a shared schema, a database type, an endpoint
path, a request/response shape, or an SSE frame shape, read the corresponding
client code** (`/Users/steve/Projects/fridgeezy/src/shared/api/`, and that repo's
own `CLAUDE.md`). A change that only compiles here still breaks the app: the
client pins a built tarball, so schema edits do not reach it until the lib is
rebuilt, packed, and reinstalled there.

## Commands

```bash
npm run api            # nx run api:serve — Express on http://localhost:8000
npm run build:all      # nx run-many -t build --all
npm run build:shared   # build only tag:scope:shared libs
npm run lint:all

npx nx run @fridgeezy/api:build
npx tsc --noEmit -p apps/api/tsconfig.app.json    # type check the API
```

Database (`apps/database`, all `npx nx run @fridgeezy/database:<target>`):

- `up` / `reset` — `supabase migration up --linked` / `db reset --linked`
- `types` — regenerate `database.types.ts` **and** the derived entity types
- `embed-ingredients|embed-categories|embed-units|embed-tags|embed-suggestions|embed-recipes`
  — all six run one script, `src/scripts/generate-embeddings.ts <target>`. They
  backfill only rows missing a vector; append `-- --all` to re-embed everything,
  which is what you want after changing a text builder. `embed-ingredients` is
  the one to reach for after any bulk import: `seed-ingredients` embeds only the
  rows it creates, so anything the LLM added arrives without a vector and stays
  invisible to similarity matching until this runs.
- `seed-ingredients`, `generate-ingredient-seed`, `generate-category-images`
- `dedupe-ingredients` — an audit, not routine. Nothing calls it; run it only
  when the catalog visibly holds two names for one thing ("scallion" /
  "green onion"). Dry run unless `DEDUP_APPLY=true`, and it costs ~5N LLM calls.

Scripts sit in two directories, split by what they touch:

- `apps/database/src/scripts/` — **changes the database or storage**, and most
  cost money: seeding, embeddings, category images, the dedupe audit.
- `apps/database/tools/` — **regenerates source files in this repo**:
  `generate-types` (Supabase → `database.types.ts`) and `generate-entity-types`
  (that file → the `entities/` wrappers). Deterministic, no production effects.

Keep that line intact when adding a script — it is the difference between "safe
to run any time" and "this writes to prod".

The `supabase` CLI is pinned to an **exact** version (2.72.2), not a caret range,
because its destructive commands differ across versions. On 2.72.2 `db reset`
seeds by default and offers `--no-seed` to opt out; on 2.111 the docs describe
`--include-seed`, i.e. the opposite default. Under `^2.67.3` a fresh install
picked up whichever was current, so the same `db reset --linked` either seeded or
did not depending on the day. Before upgrading, re-read `db reset --help` and
adjust the `reset` target to match — do not assume the flags carried over.

The Supabase project root is **`apps/database/`**, not `apps/database/src/` —
that is where `config.toml`, `migrations/` and `seeds/` live, and where the CLI
resolves it. They must not diverge: when they did, `db dump`, `migration repair`
and `migration list` all failed in ways that looked unrelated, and
`migration list` reported an empty Local column while happily connecting.

Seeds run in glob order (`./seeds/*.sql`), so the numeric prefixes are load
order, not decoration — `0021_…` once sorted ahead of `002_…` because `'1'`
precedes `'_'`. Ingredients are **not** seeded by `db reset`; run
`seed-ingredients` after one.

Evals (`npx nx run @fridgeezy/api:<target>`): `eval`, `calibrate`,
`calibrate-ingredients`, `calibrate-authenticity`, `eval-model-migration`,
`check-streaming-conformance`.

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

`createRestRouter` (`apps/api/src/api/v1/rest`) mounts the feature modules from a
`MOUNTS` array; the startup banner is *derived* from that same array, so adding a
route needs no second edit.

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

`apps/api/src/modules/ai/tools` holds tool definitions (zod input/output schemas +
handler). `modules/chat` converts them to OpenAI function-calling schemas
(`convert-tools-to-openai.ts`) and executes the handlers directly — there is no
MCP server or transport in this repo.

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
