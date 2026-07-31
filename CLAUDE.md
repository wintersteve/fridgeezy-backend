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
- `embed-categories|embed-units|embed-tags|embed-suggestions|embed-recipes`
- `seed-ingredients`, `generate-ingredient-seed`, `generate-ingredient-substitutes`
- `dedupe-ingredients`, `dedupe-recipes`, `normalize-names`, `generate-category-images`

Evals (`npx nx run @fridgeezy/api:<target>`): `eval`, `calibrate`,
`calibrate-ingredients`, `calibrate-authenticity`, `eval-model-migration`,
`check-streaming-conformance`.

## Layout

```
apps/api          Express API (@fridgeezy/api)
apps/database     Supabase migrations, seeds, embedding + maintenance scripts
infra             Terraform for the Lambda deployment
libs/fridgeezy/schemas   Zod v4 request/response schemas — shared with the client
libs/fridgeezy/types     Generated database.types.ts + derived entity types — shared with the client
libs/fridgeezy/domain    Platform-agnostic domain types, repo interfaces, Result/base-error
libs/supabase     Supabase client + repositories (categories, ingredients, recipes, suggestions, tags, units)
libs/openai       OpenAI client + embeddings
libs/bedrock      Anthropic-on-Bedrock streaming completions
libs/llm          Provider seam: resolveProvider() / generateStream() over openai|bedrock
libs/genai        @google/genai image generation
libs/streaming-server   createStreamHandler, SSE plumbing, CORS, raw-body parsing
libs/toolkit      Canonicalisation helpers (names, ingredient canonical ids, signatures)
```

Nx projects are package.json-based (no `project.json`); workspaces are
`apps/*`, `libs/*`, `libs/fridgeezy/*`. Libs are tagged `scope:shared`, apps
`scope:app`.

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
`ingredient_substitutes` table was dropped in `20260727000009` for that reason.

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

- **OpenAI** (`@fridgeezy/openai`) serves every production request path today —
  chat, suggestions, recipe generation, and embeddings — via the shared `openai`
  client.
- **Bedrock** (`@fridgeezy/bedrock`, `@anthropic-ai/bedrock-sdk`) is wired up but
  currently only exercised by the model-migration eval harness
  (`apps/api/src/evals/model-migration/`).
- **`@fridgeezy/llm`** is the seam meant to unify them: `resolveProvider()` reads
  `LLM_PROVIDER` (`openai` | `bedrock`, defaulting to `openai` and throwing on
  anything else) and `generateStream()` dispatches accordingly. API call sites
  have not been moved onto it yet — they still import `@fridgeezy/openai`
  directly. Route new completion call sites through `@fridgeezy/llm`.
- **`@fridgeezy/genai`** (`@google/genai`) generates recipe images.

### Chat tool calling

`apps/api/src/modules/ai/tools` holds tool definitions (zod input/output schemas +
handler). `modules/chat` converts them to OpenAI function-calling schemas
(`convert-tools-to-openai.ts`) and executes the handlers directly — there is no
MCP server or transport in this repo.

### Persistence

`@fridgeezy/supabase` exposes one repository per table; RPC-heavy writes
(`persistWithRelations`, merge functions) live in SQL under
`apps/database/src/supabase/migrations/`. `@fridgeezy/domain` holds the
platform-agnostic types and repository interfaces those implement.

## Conventions

- DB columns are `snake_case`; TS properties are `camelCase`; SQL function params
  take a `p_` prefix. **LLM output fields are `snake_case`** so they line up with
  the DB and parse straight through the Zod schemas.
- Schemas import from `zod/v4`.
- `libs/fridgeezy/types/src/lib/database.types.ts` is generated — regenerate with
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
