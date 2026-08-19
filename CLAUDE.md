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
npm run api            # nx run api:serve — Express on :8000, REMOTE Supabase
npm run api:dev        # nx run api:serve:dev — Express on :8000, LOCAL Supabase
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
- `seed-ingredients`, `generate-ingredient-seed`
- `classify-ingredient-diet` — fills `ingredients.dietary_properties`, which is
  what every dietary filter and every dietary chip on a card derives from. Dry
  run unless `DIET_APPLY=true`; `DIET_ONLY=`, `DIET_LIMIT=` and
  `DIET_RECLASSIFY=true` narrow or repeat it.

  **This is the BULK path, not the only one.** The API classifies each
  ingredient as it is created — `classifyNewIngredients`
  (`modules/ingredients/services`), called from both ingredient pipelines — so
  this is for a freshly seeded catalogue, for a re-run after a prompt change
  (`DIET_RECLASSIFY=true`), and for anything the write path missed. Both share
  one prompt, in `libs/dietary`, so they cannot disagree about what "gluten"
  means.

  **An unclassified ingredient is invisible, not wrong**, and that asymmetry is
  the design: `dietary_classified_at IS NULL` makes every recipe using it
  UNKNOWN, and unknown is excluded from every dietary filter — because the
  alternative is telling someone a dish is nut-free when nobody has checked. The
  cost is that one unclassified ingredient silently withdraws its dish from the
  vegan, gluten-free and allergen filters *and* from `recipe_display_tags`, with
  nothing to report it. That is exactly what a fresh local stack looks like:
  the seeds insert ingredients with no classification, so **every card shows no
  dietary chip and every dietary filter comes back empty until this is run.**

  An empty property array is a real answer ("carries none of them") and is what
  lets a dish read as vegan — not the same as never having asked, which is why
  the timestamp is stored rather than inferred from the array being empty.
- `generate-cuisine-cards` / `generate-cuisine-banners` — the two cuisine
  surfaces on the home feed, into the `cuisine_cards` (portrait card) and
  `cuisine_banners` (wide banner) buckets. Both key on the client's curated
  `TOP_CUISINES` spelling, which is also what `CUISINE_BLURBS` keys on — those
  three lists have to agree exactly or a tile 404s.

  They replaced `generate-category-images` and its square `cuisine_images`
  bucket, both removed on 2026-08-13 along with the bucket's objects. Note the
  name that script carried: it wrote to `cuisine_images`, never to the
  `category_images` bucket, which is a separate ingredient-category set nothing
  in this repo currently writes.
- `generate-dish-tiles` — the plated tiles behind the compose card, plus the
  abstract `bowl-placeholder` the suggestion cards use as their "no photo yet"
  state, into the `dish_tiles` bucket. Generated at the aspect they are
  displayed at (`9:16`), so they are deliberately **not** padded — see below.
  **Skips anything already in the bucket** unless you pass `-- --force`: these
  are curated generations, and a re-roll gives a different picture for the same
  prompt, so a routine re-run must not silently replace art someone chose.

  The bucket was `ingredient_tiles` until 2026-08-05, back when the tiles were
  raw ingredients and only the compose card read them. Buckets cannot be renamed
  in place, so `20260805000001_dish_tiles_bucket.sql` creates the new one and the
  old is left standing until any client holding the previous URLs has aged out.
- `generate-app-icon` — candidates for the app icon, at 1:1, into
  `operations/output/icons/` (gitignored). `-- --only=<name>` rolls one.
  The shipping icon is `bowl-overhead` plus its `bowl-overhead-dark` counterpart;
  both are committed in the *client* repo as `icon-light.png` / `icon-dark.png`,
  and the client's `scripts/generate-icons.mjs` derives every other icon and
  splash asset from them.

  **Icons want the opposite framing from the splash.** `generate-splash` fights
  the model to stop it centring a subject in a margin; an icon is a 40pt object
  under a squircle mask and *needs* that margin. The file says so at the top —
  do not carry one lesson into the other.

- `generate-splash` — full-bleed launch-screen artwork, one render per theme,
  into `operations/output/splash/` (gitignored). `-- --variant=dark` re-rolls one
  theme, `-- --candidates=N` changes how many.

  **Not what currently ships.** The launch screen was rebuilt as the app icon on
  a flat matching colour, so nothing in the client reads this any more. Kept
  because it works and full bleed is a plausible thing to want again — but read
  the client's `CLAUDE.md` first, because `resizeMode: "cover"` does not actually
  produce a full-screen image on iOS without a deprecated flag.

  Both of these are **image operations that write to disk instead of a bucket** —
  a splash or icon is drawn before the app has reached the network, so it has to
  be bundled into the binary and therefore lives in the client repo. Pick a
  candidate by eye and copy it across; the script prints the step, the way
  `env-remote` prints the client's `EXPO_PUBLIC_*` lines.

  Both are pinned to `gemini-3-pro-image-preview` rather than taking the Flash
  default: the per-dish volume argument behind that default does not reach an
  asset generated once, ever, and shown on every launch.

  **The dark variants are the whole reason `tone` exists** — see `libs/genai`
  below. Four passes and twelve renders to get a dark ground out of a style built
  for cream; the failure and the fix are recorded on the `tone` option itself.
- `backfill-course-tags` — one-off repair, already run on 2026-08-02. Fills a
  course tag on suggestions and recipes that have none, classifying each dish
  with an LLM. Dry run unless `COURSE_APPLY=true`; idempotent, so it is safe
  to re-run — rows that already carry a course are skipped.
- `strip-cuisine-from-names` — one-off repair, run against local on 2026-08-18
  (14 rows). Takes the cuisine label back out of dish names now that the card
  prints it above the title anyway ("Spicy Thai Cabbage Salad" ->
  "Spicy Cabbage Salad"). Dry run unless `RENAME_APPLY=true`; idempotent,
  because a name with no cuisine word in it is never sent to the model.

  **It exists because a prompt fix cannot reach a row that already exists.**
  Dedup RESOLVES to the stored suggestion or recipe rather than regenerating
  it, so a name written before the rule landed is served under that name for as
  long as the row lives — which, for a catalogue dish, is forever.

  Three things it will not do: touch an imported recipe (`created_by` non-null —
  that name was read off someone's own cookbook page), accept any edit from the
  model that is not a DELETION of cuisine words (the check is structural, so the
  worst a bad batch can do is lose a word), or force a rename that collides on
  the identity key — two dishes landing on one name means they want merging,
  which is not this script's call, so it reports them.

  It sets the renamed row's vector to NULL rather than recomputing it, which is
  exactly what `embed-suggestions` / `embed-recipes` look for. **Run those
  after.** The dish signature embeds the name, so a stale vector stays
  comparable — just to a name that no longer exists, which degrades dedup
  silently instead of failing.
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

**Then `DIET_APPLY=true … classify-ingredient-diet`, or the app looks broken in
a way nothing reports.** Ingredients arrive from the seeds unclassified, and an
unclassified ingredient makes its recipe UNKNOWN for dietary purposes — excluded
from every dietary filter, and absent from `recipe_display_tags`, which is what
the cards and the recipe screen draw their dietary chips from. So a fresh local
stack shows every dish with no dietary chip and every dietary filter empty,
which reads as a rendering bug and is not one. Ingredients created after this
classify themselves; see the target's entry above.

Local keys are the CLI's fixed values, identical on every machine and not
secrets: URL `http://127.0.0.1:54321`, Studio on `:54323`, Postgres on `:54322`.
This CLI version issues `sb_publishable_…` / `sb_secret_…` rather than the legacy
anon/service-role JWTs; supabase-js ≥ 2.90 accepts both, and they still go in the
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` variables.

### Writing the .env files

Don't hand-edit the Supabase trio — `env-local` / `env-remote` derive it:

```bash
npx nx run @fridgeezy/database:env-local              # from `supabase status`
npx nx run @fridgeezy/database:env-remote            # from SSM
```

Both rewrite **in place, touching only `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`** — your LLM keys, `SUPABASE_PROJECT_ID`, comments
and commented-out blocks all survive, so it is safe to re-run and needs no AWS
credentials in local mode. Which files each one owns:

| | writes |
| --- | --- |
| `env-local` | `apps/api/.env.dev`, `apps/database/.env` |
| `env-remote` | `apps/api/.env.production` |

**`apps/database/.env` is only ever written local, and that is deliberate.**
Every `operations/` script writes to whatever it says, so a remote value there
is one stray `embed-* -- --all` away from a production incident — and now that
`npm run api` is the *production* serve, `env-remote` is a routine command
rather than a rare one. The `-remote` database targets don't read it; they go
through the linked project.

### Which database the API serves

Split by Nx configuration rather than by editing a file:

```bash
npm run api          # nx run api:serve      → apps/api/.env.production (REMOTE)
npm run api:dev      # nx run api:serve:dev  → apps/api/.env.dev       (LOCAL)
```

Nx loads `.env.<configuration>` from the project root ahead of `.env` and does
not override what it already has, so the shared `.env` keeps the LLM keys for
both while the Supabase trio comes from whichever configuration you named. That
makes "which database am I pointed at" a property of the command you typed
instead of a comment you have to remember to swap back — the previous single
`.env` with the remote block commented out underneath had no way to tell you
which half was live.

**Note this inverts the convention the database targets use**, where the short
name is the safe one (`reset` local, `reset-remote` linked). Here the bare
`npm run api` reaches the live project and `api:dev` is the local one. Worth
knowing before you reach for muscle memory: `nx run api:serve` writes to the
database the app actually serves.

The verification that the two are genuinely different databases, if you change
this wiring: fetch a recipe id that exists only locally through
`GET /rest/recipes/:id/share` on both. `:dev` answers 200 with the dish name,
plain `serve` answers 404.

Nothing is templated. Local values come from `supabase status -o json` and
remote ones from SSM, which `infra/put-secrets.sh` already treats as the source
of truth for the deployed function — so a CLI upgrade that changes the key
format (this one moved off anon JWTs) flows through instead of leaving a stale
literal behind, and no remote secret has to live in a committed file. The remote
mode reads the Function URL from `terraform output` for the same reason.

The client is a **separate repo**, so its four `EXPO_PUBLIC_*` lines are printed
to stdout to paste rather than written — a hardcoded cross-repo path is exactly
what breaks on someone else's machine.

**The backend `.env` files always get `127.0.0.1`, and only the printed client
block gets the LAN IP.** The API and every `operations/` script share a machine
with the Docker stack, so `SUPABASE_URL` is a server-to-server address that
never leaves the host — a LAN IP there bought nothing and broke on every network
change, which is exactly how both files ended up pinned to a `192.168.1.x` lease
that had long since expired. `localhost` on a *phone* means that phone, which is
why the client half still needs a routable address.

There used to be a `--simulator` flag to force loopback. It is gone: loopback is
now unconditional on the side that wanted it, and the side that cannot use it
resolves the address itself.

**For local work you can ignore the printed block entirely.** The client's
`npm run start:dev` (`scripts/with-local-env.sh`) re-resolves `en0` at launch and
exports the four values over the top of `.env` — shell env wins in Expo's dotenv
loading — so a new network or a new lease costs a restart rather than an edit.
Paste the block when you want the file itself to be right, or for `env-remote`.

One backend URL genuinely does reach the phone: `getRecipeImagePublicUrl` in
`create-recipe-image.ts`, whose output is persisted to `recipes.image` and
streamed to the client, where `DishImage` **prefers the stored column** over the
name-derived fallback it would otherwise compute. It therefore swaps loopback
for the LAN address itself, at request time. That is a no-op in every deployed
configuration by construction rather than by a flag — Lambda's `SUPABASE_URL` is
the project's https origin and has no loopback host to match.

Note the sharp edge that leaves: a row written on one network stores that
network's address. Locally the repair is `update recipes set image = null` —
the client falls back to `recipeImageUri(name)`, built from its own env, which
is correct on whatever network it is on. (Done once on 2026-08-07, 27 rows.)

After changing the client's `.env`, restart Expo with `npx expo start --clear` —
`EXPO_PUBLIC_*` values are inlined at build time, so a running Metro keeps
serving the old ones however many times you edit the file.

Two things that will waste your time otherwise:

- **A running API server does not pick up an `.env` change.** `nx serve` dedupes,
  so a second `npm run api` attaches to the existing process rather than starting
  a fresh one — it prints "Waiting for @fridgeezy/api:serve:production in
  another nx process" and you end up testing the old configuration. Restart the
  server itself, or run `PORT=8001 node apps/api/dist/main.js` for a throwaway
  instance on another port — note a bare `node` run loads no `.env` at all (Nx
  is what does that), so give it the variables yourself:
  `set -a; . apps/api/.env; . apps/api/.env.dev; set +a`.
- **`api` and `api:dev` do not dedupe against each other** — they are different
  tasks, so Nx starts the second rather than attaching, and it dies on `EADDRINUSE`
  for port 8000. That is the good outcome: the failure mode it replaces is two
  servers where you believe you have one, and no way to tell from the banner
  which database the one you are talking to is on. Stop the first, or give the
  second a `PORT`.
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
`eval-step-structure`, `check-streaming-conformance`, `check-batch-dedup`.

`eval-step-structure` takes `-- --only=baseline` to run just the shipped prompt
instead of all five variants — a fifth of the spend, and the only variant that
reflects production — and `-- --repeat=N` to generate each dish N times.

**Its step count needs repeats to mean anything.** Nine generations of the
byte-identical shipped prompt spread **6 to 12 steps** (mean 8.8), and one dish
alone gave 6/7/8. So a single-run difference in that column is not a small
signal, it is no signal — that applies to comparisons between variants, not just
across dates. `--repeat` reports `mean (min-max)` for exactly this reason, and at
`--repeat=1` the footer says the number is unusable rather than leaving you to
infer it. The quality columns (dual-unit temperatures, °F, duration and
temperature field coverage) held at 0/0/100%/100% across all nine — those are the
stable signals.

`check-batch-dedup` is the odd one out and the cheapest thing here: no database,
no LLM, no API key, runs in milliseconds. It drives the intra-batch dedup
coordinator through the interleavings the real stream produces — including four
identical dishes settling in reverse arrival order — because what it protects is
a **concurrency** property, and one that holds "usually" is what put `Haemul
Pajeon` next to `Pajeon` in the first place. Run it after touching
`suggestion-batch.ts`.

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
apps/site         Static marketing/legal pages — exported to S3, see "The public site"
infra             Terraform for the Lambda deployment + the site's S3/CloudFront
libs/schemas      Zod v4 request/response schemas — packed for the client
libs/types        Generated database.types.ts + derived entity types — packed for the client
libs/domain       Platform-agnostic domain types, repo interfaces, Result/base-error
libs/supabase     Supabase client + repositories (categories, ingredients, recipes, suggestions, tags, units)
libs/openai       OpenAI client + embeddings
libs/bedrock      Anthropic-on-Bedrock streaming completions
libs/llm          Provider seam: resolveProvider() / generateStream() over openai|bedrock
libs/genai        @google/genai image generation + the shared food-illustration art direction
libs/dietary      Ingredient dietary-property vocabulary + the classification prompt
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
| `POST /rest/recipes/import` | `modules/recipes` |
| `POST /rest/recipes/:recipeId/compose` | `modules/recipes` |
| `POST /rest/recipes/:recipeId/chat` | `modules/recipes` |
| `GET /rest/recipes/:recipeId/share` | `modules/recipes` — **open** |
| `POST /rest/substitutes/generate` | `modules/substitutes` |
| `POST /rest/chat` | `modules/chat` |
| `POST /rest/billing/revenuecat` | `modules/billing` — **open** |
| `GET /rest/health` | direct — **open** |

**Every route above requires a Supabase access token**
(`Authorization: Bearer <access_token>`), checked by `requireSupabaseUser` in
`middleware/require-auth.ts`, **except the three marked open**. The middleware is
applied inside the `MOUNTS` loop rather than to the whole router, so a new
feature module cannot be added unauthenticated by accident.

Opening a route is a **positive declaration**, never an omission: a module puts
it on a second, separately-exported router (`RecipesPublicRoutes`) and names it
as `publicRouter` on its `MOUNTS` entry, which mounts it at the same prefix ahead
of the gated one. Anything that router does not match falls through to the gate,
so `POST /rest/recipes/:id/share` is still a 401 — only the declared method and
path are open. The startup banner marks every open route with `← open` and counts
them on the `auth` line, so an unintended one shows up on every boot rather than
only in the diff that introduced it.

**`/share` has to be open, and the reason generalises.** A link preview is built
by the *receiving* app — iMessage, WhatsApp, Slack fetch the URL themselves — and
so does the browser of whoever taps it. None can hold a Supabase session, so
gating it returns 401 to every one of them and the preview card and page both
vanish. That is precisely what happened: the route landed 2026-08-04, the gate
landed 2026-08-06 and swept it up, and nothing failed — the client's own notes
still described previews as working. **Before gating or ungating anything, ask
who the caller is**; for `/share` it is not the app. It is safe to open because
it serves only a recipe's name, gloss and image, keyed by an id the sharer chose
to hand out, with no LLM call and so no spend behind it.

**`/billing/revenuecat` is open for the same reason and is not the same case.**
RevenueCat is a server-to-server caller with no Supabase session, so it needs the
seam — but unlike `/share` it **writes**, and an unprotected entitlement webhook
lets anyone grant themselves a subscription. It is protected by a shared secret
(`REVENUECAT_WEBHOOK_SECRET`), compared in constant time before the body is even
read. **RevenueCat does not HMAC-sign its webhooks the way Stripe does** — it
echoes back whatever `Authorization` value you configure in its dashboard, so
that secret is the entire protection and it must match in two places with
nothing to report drift but every event failing. The rule: the seam makes a route
*reachable*, the handler makes it *safe*.

### The public site (apps/site)

The marketing/legal pages — landing, `/support`, `/privacy`, `/terms`, plus a
`404.html` — are a **static export**, not API routes. `apps/site` holds pure
render functions (no Express, no deps); its `build` target
(`npx jiti src/build.ts`) writes finished HTML plus `assets/` (app screenshots,
self-hosted fonts, the OG image) into `apps/site/dist`, with subpages as
`<name>/index.html` so links stay extensionless. They were briefly served by
the Express app itself; deliberately moved out — marketing pages have no
business waking a Lambda, and S3+CloudFront serves them for cents.

Hosting is `infra/site.tf`: a **private** S3 bucket read by CloudFront through
an OAC (the S3 *website* endpoint was rejected — it is http-only), a CloudFront
function rewriting extensionless paths to their index object, and 403/404
mapped to `/404.html` (S3 behind an OAC answers 403 for a missing key).
Deploy is `./infra/deploy-site.sh`: builds with `SITE_ORIGIN` from
`terraform output site_url` (crawlers need absolute `og:image` URLs — same
source-of-truth pattern as `env-remote`), syncs assets at a day of
Cache-Control and pages at five minutes, fixes woff2 content types the aws CLI
guesses wrong, and invalidates. The share page is unaffected: it is dynamic
and stays on the Lambda; when the custom domain lands, the plan in `site.tf`'s
header is one distribution with `/rest/*` as a second behavior.

Every value in `src/chrome.ts` is lifted from the client's theme constants
(`fridgeezy/src/shared/theme/constants/`) — when those change, this is the
copy to update. The screenshots are real captures of the dev app on the iPhone
simulator (light + dark, status bar overridden to 9:41), converted to 780px
WebP; the per-screen deep links and the AsyncStorage trick for forcing the
app's dark theme are in the auto-memory's simulator notes. Fonts are
self-hosted rather than Google-CDN'd on purpose (GDPR — LG München).

`requireEntitlement` (`middleware/require-entitlement.ts`) answers **402**, not
401 — "you are who you say you are, and this needs a subscription", which is what
tells the client to show the paywall rather than the login screen.

**It is attached per ROUTE, not per mount** (2026-08-12). It used to run on every
mount except `billing`, which made "signed in" and "subscribed" the same thing.
The product now has three tiers and the split runs *through* the recipes module
rather than between modules:

| Tier | Gets |
| --- | --- |
| **guest** | the catalog, read straight from Supabase — never reaches this API |
| **account** | every prompt: generate, promote, chat, extract, substitutes, modify, escalate |
| **subscriber** | premium routes — currently only `POST /recipes/:id/compose` |

So the MOUNTS loop applies `requireSupabaseUser` alone, and a premium route names
the gate itself:

```ts
router.post("/:recipeId/compose", requireEntitlement, RecipesController.compose);
```

Note this is the opposite of how authentication works, and deliberately so. Auth
is applied by the loop precisely so a new module *cannot* be added
unauthenticated; premium is now an addition someone has to remember. The failure
directions differ — forgetting auth is a security hole, forgetting this gives a
premium route away — and the safety net is that the startup banner **derives**
`← premium` from a marker the middleware sets on itself
(`requireEntitlement.isEntitlementGate`) and counts it on the `billing` line. A
route that lost its gate shows up on every boot. **After adding a premium route,
read the banner.** The marker is a property rather than the function's name
because esbuild may rename a local binding in the Lambda bundle, which would
leave the banner reporting zero while the gate was in fact enforcing.

`entitlementExempt` is gone — with the gate opt-in per route, nothing needs
exempting.

**`REQUIRE_ENTITLEMENT=true` is still opt-IN, inverting `ALLOW_UNAUTHENTICATED`
deliberately.** Failing closed here would put the paywall in front of routes the
product now gives away. It is a rollout switch — **flip it on in the same release
that ships purchasing, then delete the flag.** The startup banner shouts while it
is off, because "off" is both correct today and silently expensive the day it
stops being. It also stands down when `ALLOW_UNAUTHENTICATED=true`: with no auth
there is no user id to look an entitlement up for, and that combination used to
answer 500 "misconfigured" on every premium route.

State lives in `profile_entitlements`, written **only** by the webhook (RLS has a
select policy and deliberately no insert/update/delete, so every client role is
denied and the service role bypasses). It is not a column on `profiles` because
that table is client-writable.

Three things in there are easy to get backwards, and all three are load-bearing:

- **Activity is derived, never stored** — `revoked_at is null AND (expires_at is
  null OR expires_at > now())`. A missed `EXPIRATION` webhook is the normal
  failure, since it is the one event no user action triggers; deriving means that
  costs a late revocation instead of an indefinite free ride. The rule exists
  twice, as `entitlement_is_active()` in SQL and `isEntitlementActive` in TS —
  **they must agree**, and a divergence lets the wrong people in silently.
- **`CANCELLATION` does not revoke.** On both stores it turns off auto-renew and
  the subscription runs to its paid-for expiry. Revoking there cuts off someone
  who has paid for the rest of the month. Only `REFUND` and `SUBSCRIPTION_PAUSED`
  revoke.
- **The webhook is idempotent *and* order-independent.** RevenueCat retries on any
  non-2xx and does not promise ordered delivery, so `applyEntitlementEvent`
  ignores an event id it has already applied and any event older than the one
  already stored — without which a late `EXPIRATION` would revoke a subscription
  that has since renewed. Status codes are control flow: a database failure
  returns **500 on purpose** so the event is redelivered, because a 200 that
  stored nothing loses a purchase permanently.

`TRANSFER` is received and **deliberately not applied** — the top-level
`app_user_id` does not reliably say which side of the transfer the event is
about, so the generic path would be a coin flip between revoking a payer and
granting a non-payer. It is logged at error level and acknowledged.

**Known gap: the purchase-to-webhook window.** A user is entitled on-device
seconds before the webhook arrives, so a fresh purchase can see one 402. The fix
is a fallback read of RevenueCat's REST API on a miss, bounded to users with no
active row; not built, and recorded in `TODOS.md`.

This lives in the app, not on the Function URL, and that is forced rather than
chosen: a Function URL is `AuthType: NONE` or `AWS_IAM`, and `AWS_IAM` requires
the caller to SigV4-sign every request with real AWS credentials — which a
published React Native binary cannot hold without leaking. Cognito could issue
temporary ones, at the cost of a second identity system beside the Supabase one
the app already has. So the URL stays open and the app closes the door one hop
later. `TODOS.md` records this; do not "fix" it by flipping the auth type.

`ALLOW_UNAUTHENTICATED=true` disables the gate for local `curl` work. There is
deliberately no positive `AUTH_REQUIRED` flag — forgetting to set anything has to
be the *safe* outcome — and the startup banner shouts when the gate is off.

**The client must send the header on every `/rest` call.** Both call sites are
already updated: `use-sse-stream.ts` (the single choke point every SSE feature
goes through) and `use-extract-ingredients.ts` (the one non-SSE call). The SSE
hook reads the token from the auth *context* and holds it in a ref, deliberately
**not** as an effect dependency — a token refresh mid-stream would otherwise tear
down a live connection and re-issue the request, buying a second paid LLM call to
replace one that was working.

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
  the default provider is `openai`. **Exactly one thing bypasses the facade now:
  embeddings** (`generateEmbedding` / `generateBatchEmbeddings`, Phase 4). Chat
  and ingredient extraction were both ported and go through `@fridgeezy/llm`.
  Because `libs/openai` throws at *import* on a missing key, that one remaining
  import keeps `OPENAI_API_KEY` a hard boot requirement — so the key cannot be
  dropped while Phase 4 stays cut.
- **Bedrock** (`@fridgeezy/bedrock`, `@anthropic-ai/bedrock-sdk`) is reachable
  from every ported call site by setting `LLM_PROVIDER=bedrock`, but **has never
  run end-to-end** — Anthropic models are gated on this AWS account. Its streaming
  translation and usage accounting are covered offline by
  `check-streaming-conformance`.

  **Prompt caching is opt-in here and automatic on OpenAI** — the one place the
  two providers genuinely differ rather than just spelling something differently.
  OpenAI caches prefixes with no code at all, which is why the
  `buildRecipeSystemPrompt` reorder paid off on its own; Anthropic needs explicit
  `cache_control` breakpoints, and Bedrock does not offer the automatic kind.
  `buildParams` therefore sends `system` as a content block with
  `cache_control: {type: "ephemeral"}` rather than as a bare string.

  **One breakpoint, on `system`, and nothing volatile may move above it.** Render
  order is `tools` → `system` → `messages`; this client sends no tools and the
  user turn changes every request, so the end of `system` is the end of
  everything cacheable. The failure modes are silent and cost money rather than
  correctness — a missing marker bills full price, a marker on the user turn pays
  the ~1.25x write premium for a read that never comes — which is why
  `check-streaming-conformance` asserts both.
- **`@fridgeezy/genai`** (`@google/genai`) generates recipe images. It also owns
  `buildFoodIllustrationStyle` — the art direction shared by recipe heroes
  (`create-recipe-image.ts`) and the home feed's cuisine surfaces
  (`operations/generate-cuisine-cards.ts`,
  `operations/generate-cuisine-banners.ts`). Those render on the same
  screen and previously kept separate copies of the same paragraph, which
  drifted: the recipe prompt lost the palette hex codes the cuisine one kept and
  started producing a green plate on marble for one dish and a rustic speckled
  bowl for the next. **Add a new image call site by composing its own subject
  section around that builder** — only `framing`, `mood`, `renderingEmphasis`
  and `vessel` are per-surface, and each exists because the surfaces differ
  concretely: they are cropped differently, and a recipe hero wants detail
  concentrated on the centrepiece while a 110px cuisine tile needs it spread
  evenly to read at all.

  `vessel` is the newest and the sharpest-edged. It defaults to `"ceramic"`;
  `"none"` is for a surface whose subject is raw ingredients rather than a
  plated dish (`generate-dish-tiles`). It swaps the `Vessel` **and**
  `Background` lines together, because dropping the plate alone leaves
  "completely empty … no stray garnish outside the vessel" governing a
  composition with no vessel, which reads as an instruction to shrink the
  subject back to the middle. Everything else — camera, light, palette, tone,
  rendering — stays shared, which is the point: a tile and a hero on the same
  screen still have to look like one kitchen. The `"ceramic"` output is
  byte-identical to what the 2026-08-04 A/B rounds were run against; if you
  touch this builder again, check that it still is.

  `tone` is the sharpest-edged of all, and the one to be careful with. It
  defaults to `"high-key"` — the pale chalky register every surface in the app
  shares — and `"low-key"` exists for exactly one surface, the launch screen's
  dark variant. **A `ground` alone will not give you a dark image.** Measured
  2026-08-06 over twelve renders: asking for `#141110` and changing nothing else
  returns cream, and so does moving `Tone`, `Palette` and `Light` as well. The
  line that actually decides it is `Rendering`, because *watercolour is
  transparent pigment on white paper* — ask for it on black and the model puts
  the paper back. Low-key swaps the medium for opaque gouache and chalk pastel.

  That makes it four of the eight fixed-style lines, so **low-key is a sibling
  of the house style rather than a setting of it**. Do not put one on a surface
  that sits beside a recipe hero or a cuisine tile; unlike `camera: "overhead"`
  the mismatch would not be subtle. The high-key output is verified
  byte-identical across all four existing call-site shapes — re-check that if
  you touch it.

  One more thing the low-key work surfaced: "full bleed" means opposite things
  on the two grounds. On cream, bare ground is a void, so the subject is told to
  *cover* every corner. Tell a dark ground the same and it obeys — covering the
  dark with pale pigment and handing back a light picture. Dark asks the blooms
  to *reach* the edges while the ground stays the majority of the frame.

  **`padPngToSquare` is not a step every image takes.** It exists because one
  recipe asset is cropped three ways, and it works by shrinking the subject
  relative to the frame. An asset generated at the aspect it is displayed at
  must skip it — `generate-dish-tiles` renders 9:16 for a 9:16 slot, and
  padding would undo the framing it asks for.

  The default image model is `gemini-3-pro-image-preview`, picked by a blind A/B
  on 2026-08-04 rather than by preference. Flash renders this art direction as
  flat, hard-outlined cel shading whatever the prompt says, and six prompt
  rewrites failed to close the gap — the model was the ceiling, not the wording.
  Pro costs ~$0.14/image against Flash's ~$0.039, bounded per *dish* rather than
  per view because `generateAndUploadRecipeImage` short-circuits on an existing
  object at the deterministic storage path. `GENAI_IMAGE_MODEL` overrides it
  without a deploy, which matters — Pro is a **preview** endpoint and can be
  renamed or repriced. The recipe prompt's restraint rules are the variant that
  degraded best on Flash, so that fallback stays viable.

  **Google retires model ids underneath you, and it presents as a 404.**
  `gemini-2.5-flash` began answering *"no longer available to new users"* in
  mid-August 2026, which reached the app as a dead microphone button rather than
  as anything naming a model. `interpretCommand` therefore runs on the
  `gemini-flash-latest` **alias**: for a classifier held to a tight prompt and a
  strict schema, model drift is cheap and an outage is not. TTS and images stay
  pinned, because there the exact model *is* part of the output. When a call
  that worked last week 404s, check the model id before anything else — and note
  that `GET /v1beta/models` will happily list a model the key can no longer use.

  Recipe images are **padded to a square by `padPngToSquare` before upload**.
  The client shows one asset in boxes from 0.62 to 1.36 aspect, all cropping to
  fill, and a 3:4 render loses 45% of its height in the widest of them — it cut
  through the plate on every dish measured. Padding shrinks the plate relative
  to the frame without touching the artwork, so one asset survives all three
  crops while staying full-bleed. Note what this rules out: asking the model for
  a smaller plate does not work (measured — plate size swings 51–87% of frame
  height on an identical prompt), and `contentFit="contain"` in the client is
  wrong because these surfaces are full-bleed. `libs/genai` therefore
  externalises `node:` builtins in its vite config; the padder uses `zlib` to
  avoid a native image dependency on Lambda.

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

### Deployment: secrets and Terraform state

Two things that look like ordinary infra config and are load-bearing:

- **The Lambda holds no secrets in its environment.** It is given one variable,
  `SSM_PARAMETER_PREFIX`, and `apps/api/src/load-secrets.ts` fetches the
  parameters by path at cold start. Terraform used to read them itself and inject
  the values, which put five plaintext secrets into the state file — and, with
  versioning on, into every historical copy of it, so rotating a key never
  removed the old one. Nothing sensitive reaches state now, which is the only
  reason the S3 backend is safe to use. **Do not add a secret to the
  `environment` block in `lambda.tf`**; it goes straight back into state and
  nothing fails to tell you.

  Because the parameter's *name* becomes the env var's name, adding a sixth
  secret is `put-secrets.sh` plus a cold start — no `terraform apply`, no infra
  change. Add it to `REQUIRED_KEYS` only if the app cannot boot without it.

  The consequence to know: a missing parameter no longer fails at plan time, it
  fails at the first invocation. `loadSecrets()` clears its memo on rejection, so
  fixing the parameter is picked up by the next request without a redeploy.

- **`lambda.ts` imports `./create-app` dynamically, and that is not a style
  choice.** `libs/openai`, `libs/genai` and `libs/supabase` all construct their
  client at module scope and throw on a missing key, so a static import would
  evaluate that graph before the secrets arrived and the function would die at
  cold start with `Missing OPENAI_API_KEY`. Deferring the import is what buys the
  ordering — and it meant none of those libs had to change. `build-artifact.sh`
  asserts both halves: that requiring `lambda.js` with **no** secrets in the
  environment succeeds, and that `loadAppModule()` then loads the full graph
  under Lambda's module semantics. The second check exists because the deferred
  import would otherwise have silently gutted the `ERR_REQUIRE_ESM` guard.

- **State lives in S3** (`fridgeezy-tfstate`, `api/terraform.tfstate`), locked
  natively via `use_lockfile`. The bucket is created out-of-band — a config
  cannot hold the state describing its own backend — and `infra/README.md` has
  the four idempotent commands.

One IAM subtlety worth keeping: `GetParametersByPath` authorizes against the
**path node** (`parameter/fridgeezy/dev`), not against the children the `/*` form
covers. `iam.tf` therefore lists both ARNs. Granting only the wildcard reads as
correct, plans clean, and fails at runtime.

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
   `persistOrReuseSuggestion()` wraps it, in this order — **review, batch, database,
   persist** — and the order is the design, not an accident:

   1. **Review** (`verifySuggestionAuthenticity`) — one LLM call deciding
      "is this food", "is this an attested dish" and "what is it called".
      Unauthentic dishes drop here, before anything has been spent on them.
   2. **Batch dedup** (`suggestion-batch.ts`) — in memory, against the other
      suggestions of the *same request*, which are not in the database yet.
   3. **Database dedup** — recipes first, then suggestions by exact canonical
      name, then by signature similarity.
   4. **Persist.**

   Review runs **first**, and that is load-bearing. It used to be kicked off in
   parallel and awaited last, so every dedup layer compared the name the
   *generator* happened to pick and the canonical name arrived too late to help.
   That is how the dev catalog collected `Tarte Tatin` + `Apple Tarte Tatin`
   (cosine 0.856 — gray band, adjudicated apart) and `Pajeon` + `Haemul Pajeon`:
   canonicalise first and both pairs collide on an exact name match, for free.
   The reorder costs ~0.5s of overlap, entirely behind the provisional card, and
   buys back a wasted embedding + three round trips on every dropped dish plus
   the second embedding every renamed dish used to pay.

   **Do not restore the parallel start.** The apparent latency win was paid for in
   duplicate rows.
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

  Dietary classification is the one thing that now spans both, and it had to:
  the SQL path creates its ingredients inside the same statement that writes the
  recipe, so nothing in TypeScript ever sees the new row. `persistRecipe`
  therefore re-resolves the recipe's ingredients by canonical id afterwards and
  classifies them — which is also a live check that `ingredient_canonical_id`
  (SQL) and `ingredientCanonicalId` (TS) still agree. **A third creation path
  would need the same treatment**, and nothing would fail if it were forgotten:
  the dishes would just go quietly missing from the dietary filters.
- **Ingredient names aren't grounded by retrieval** (dish names are, via
  `listCatalogDishes`): the generator free-texts them and `matchIngredients`
  reconciles after the fact. *Revisit when* the `[Ingredients]` logs show the
  gate rejecting or duplicating often.
- **The authenticity gate judges the INGREDIENTS, not the name.** Its blind spot
  was measured on 2026-08-05: a "Ceviche de Mariscos" whose ingredients were
  lime, onion, chili, sweet potato and corn — ceviche's garnishes, no seafood —
  scored `canonical` at **0.95**, *higher* than the same dish with its seafood
  intact. It was reading the name. A dietary adaptation wearing a real dish's
  name is the hardest input this gate sees, because the name, cuisine and tags
  are all impeccable; that is what hides it. Hence the `adaptation` status and
  the "name the defining ingredient, then find it in the list" test in the
  prompt. `GUTTED_DISHES` in `dedup-authenticity.eval.ts` holds that exact row —
  **keep it there.** Prompt edits that improve the common case have a habit of
  restoring this one.
- **A dietary restriction changes the DISH, never the recipe.** `BLACKLIST_RULE`
  distinguishes the two: a blacklisted item gets swapped, a dietary restriction
  means picking a dish that already complies. Strip seafood from a ceviche and
  what is left is a plate of garnishes with a lie for a name.
- **The catalog is FOOD, and the axis is "is it drunk", not "does it contain
  alcohol".** Enforced in two places, deliberately: `FOOD_ONLY_RULE`
  (`constraint-rules.ts`, shared by all three generators) stops most drinks being
  generated, and the `not_food` status on the authenticity gate is what actually
  keeps them out of the database. The prompt rule alone is not a gate — the
  generator is the thing being policed — but without it every drink costs a
  provisional card the client draws and then withdraws.

  The distinction matters in both directions and getting it backwards breaks real
  cooking: coq au vin, tiramisu and beer-battered fish are food; a virgin daiquiri
  is not. Soup and consommé are food — eaten from a bowl, even when sipped.
  `DRINKS` and `FOOD_WITH_DRINK` in `dedup-authenticity.eval.ts` pin both sides,
  and the drink fixtures are scored on the **status**, not just on `authentic`: a
  drink dropped as `invention` passes an authenticity-only assertion while
  breaking the loop-break and the rejection frame below.

  There is no drink slot in the taxonomy to fall back on — `course` is exactly
  `{appetizer, main, side, dessert}` and no `dish_form` is a beverage — so a drink
  that gets past the gate is not merely off-scope, it is stored **mislabelled**
  and then feeds `listCatalogDishes` and the signature embeddings as a dish.
- **An out-of-scope request is terminal, and says so.** The batch feed emits
  `RejectedSuggestionRequestSchema` (`{rejected: true, reason: "not_food"}`) — a
  frame with no `tempId`, so any client keying on `tempId` must branch on
  `rejected` *before* it looks one up, or a lookup miss reads as "new card".
  Withdrawal alone was not enough: four cards appearing and vanishing leaves a
  blank feed that reads as a bug.

  It also breaks the `MAX_PASSES` top-up. That loop exists to refill slots dedup
  collapsed, where re-asking plausibly returns something new; "mojito" asked again
  returns a mojito. Two separate signals feed it — the generator's own
  `{"rejected":"not_food"}` JSONL line (cheap, before any card is drawn) and the
  gate's `not_food` drop (after four have been drawn) — plus a `generatedAny`
  check, because a pass that produced nothing has nothing to top up *from*.
  Chat's single-suggestion path shares the gate but not the frame: it drops the
  dish and lets the assistant explain itself in prose.
- **A reused suggestion row is a card the feed may still have to withdraw.**
  Dedup resolving to an existing row is a success, and the single-suggestion
  endpoint returns it as-is. The batch feed must not: emitting it renders the
  same dish twice under two `tempId`s with one `id`. `generate-suggestions-stream`
  therefore suppresses a row this response already showed, or that the client
  named in `request.exclude`. Keep that decision in the *caller* — reusing the
  row is right, drawing it twice is not.
- **`exclude` is the client's list, not the catalogue's.** `listCatalogDishes`
  reads both `recipes` and `recipe_suggestions`; `request.exclude` carries what
  the client has on screen from anywhere else, including earlier batches of the
  same infinite-scroll feed. Both feed the same prompt block. The use case
  spreads `body` rather than copying fields — a hand-written copy is what
  silently dropped `exclude` for as long as the client had been sending it.
- **A short batch tops itself up once** (`MAX_PASSES`), asking only for the
  shortfall. Deliberately capped at one extra pass: a narrow filter deep into a
  feed can genuinely be out of new dishes, and chasing four would just buy more
  LLM calls to withdraw.
- **No feature flags.** Dedup and authenticity ship straight to the live path;
  `LLM_PROVIDER` is the only runtime switch. The eval targets are the safety net
  instead. Build a flag scoped to a risky change, not as a standing fixture.

Thresholds (`SIGNATURE_HIGH/LOW_THRESHOLD`, the authenticity confidence floor)
are fitted by the `calibrate*` eval targets. **Re-run the matching target rather
than hand-nudging a constant** — a nudge unfits it from the distribution it was
measured against, and nothing will fail to tell you.

**`TIME_BAND_MAX_MINUTES` is the exception, and the only one.** It is a product
statement about what a weeknight allows, not a fitted value — there is no
distribution to fit it to — so it is safe to move by hand and no `calibrate*`
target has any say. Do not add one.

### What a dish is called

`DISH_NAME_RULE` (`suggestions/services/naming-rules.ts`) is the single copy,
shared by all three generators and quoted verbatim into the naming gate's Step A
— so the rule the generator was given and the rule it is judged against cannot
drift. `verify-suggestion-authenticity` is what actually enforces it: Step C
rewrites the name before anything is persisted, and the gate runs FIRST, so
every dedup layer keys on the corrected name.

**The name carries no cuisine** (2026-08-18). The card already prints it as an
eyebrow directly above the title ("Thai · Salad"), so "Spicy Thai Cabbage Salad"
spent a third of its title on a word the reader was looking at. Stripping it is
safe because dish identity is `(canonical_id, identity_cuisine)`: two cuisines
may hold one name and `pickIdentityMatch` keeps them apart, so nothing
downstream needs the name to carry its origin.

It is a TEST, not "remove the demonym", and the four keep-cases are each a
concrete failure it would otherwise cause:

| Keeps the word | Because |
| --- | --- |
| Pad Thai, French Onion Soup, Som Tam Thai | The word is inseparable — the remainder is not the dish's name. "Som Tam" alone is the LAO dish. |
| Vietnamese Spring Rolls | The name is a translation; bare "Spring Rolls" names the fried Chinese one. |
| Som Tam Thai vs Som Tam Lao, Hiroshima-style Okonomiyaki | It is the only thing separating two real dishes — and it survives translation, giving "Thai Green Papaya Salad". |
| Crispy Pork with Chinese Broccoli | The word belongs to an INGREDIENT. Chinese broccoli is gai lan, not broccoli. |

**"An English menu would print the origin" is NOT the test** — that is true of
half the catalogue, and taking it as the test keeps the word on most of the
dishes this was built to fix. "Thai Fried Rice" -> "Fried Rice", "Sichuan Boiled
Fish" -> "Boiled Fish". The word goes whenever the remainder still names the
dish. `CUISINE_LABELLED` in `dedup-authenticity.eval.ts` pins that decision with
"Thai Fried Rice" specifically, next to `CUISINE_IN_NAME` for the other side.

Two consequences worth knowing:

- **The gate may no longer disambiguate by naming.** It used to be free to
  answer "Kazakh Manti" for the Kazakh row, and the eval recorded that as a fine
  outcome; it is now told never to add a cuisine word, because the identity key
  is what separates homographs and an added word outlives the pair it was added
  for. The homograph report in that eval now expects a collision.
- **Existing rows do not fix themselves.** Dedup resolves to the stored row, so
  the prompt only governs dishes nobody has generated yet —
  `strip-cuisine-from-names` is the repair for everything already written.

### How long a dish takes

`total_time_minutes` on both `recipe_suggestions` and `recipes`, banded into
quick / moderate / long by `timeBandFor` (`libs/schemas`) and drawn as a chip
beside the difficulty one. Added 2026-08-12, replacing a cook time the CLIENT
fabricated by hashing the card's id (`utils/recipe-meta`, now deleted) — the
real `prep_time`/`cook_time` were being selected by the client and rendered by
nothing, while the invented number was drawn next to them.

The asymmetry between the two tables is the whole design, and it is easy to
undo by accident:

- **A recipe DERIVES it**, inside `persist_recipe` / `persist_recipe_with_
  ingredient_ids`, from the same `p_prep_time` / `p_cook_time` that the INSERT
  writes. It is deliberately **not** a parameter — a caller that can pass its
  own total is a caller that can pass one disagreeing with the times on the
  detail screen, which is the class of bug this closed.
- **A suggestion ESTIMATES it**, because a card exists before its recipe does
  and there is nothing to derive from. `DISH_TOTAL_TIME_RULE` (shared by all
  three generators) asks for it, and `promote` feeds it back into the recipe
  **user** prompt as an anchor — never the system prompt, which is the cached
  prefix.

Two things that look like details and are not. The rule's **overnight
exclusion** is load-bearing: count a marinade or a prove and every biryani,
sourdough and kimchi reports 12+ hours and lands in `long` together, at which
point the band stops separating anything. And the axis is the **clock, not the
effort** — a three-hour braise is twenty minutes of work — so the top band is
worded "All afternoon" rather than as difficulty, which the chip beside it
already carries.

NULL means unknown and is never backfilled on suggestions; the client draws no
chip. `minutes_from_time_text` parses the `'15 min'` column format and returns
NULL on anything else rather than stripping non-digits, which would read
`'1 h 30 min'` as 130.

### Recipe variants: versions of one dish

A dish is a **family**: one base recipe (`recipes.base_recipe_id IS NULL`) plus
zero or more variants pointing at it. Families stay **flat** —
`resolveVariantBase` points a new variant at its source's base, never at the
source when that is itself a variant. Two things create one today, and both
persist it with the parent set **in the INSERT**:

| Path | RPC | Parameter |
| --- | --- | --- |
| `POST /recipes/modify`, `POST /recipes/difficulty/escalate` | `persist_recipe` | `p_base_recipe_id` (since the baseline) |
| `POST /suggestions/:id/promote`, when the catalogue copy is unusable | `persist_recipe_with_ingredient_ids` | `p_base_recipe_id` (since `20260815000002`) |

**Never patch `base_recipe_id` on afterwards.** A row that is briefly
`base_recipe_id NULL` is, to `recipes_canonical_id_difficulty_unique`, a second
base recipe under the base's name, and the insert is what fails — there is no
window in which to re-parent it. That is what broke difficulty escalation once
already, and the second persist RPC lacking the parameter is what made an
adapted promotion impossible until now.

The two tables beside `recipes` are per-USER and the split matters:

- **`recipe_variants`** — "this profile saved that recipe as a version of this
  dish", with a user-editable `label`. A variant recipe row exists before anyone
  saves it (the generator writes it); the join row is what keeps it alive past
  `delete_orphan_generated_recipes`. Written by the CLIENT, direct to Supabase
  under `users_manage_own_recipe_variants` — nothing in this repo inserts one.
- **`recipe_family_defaults`** — "when this profile opens this dish, give them
  that version". `unique (profile_id, base_recipe_id)` IS the one-default rule;
  setting a new one is an upsert on that key, so a family never briefly has two.

**`recipe_id = base_recipe_id` means opposite things in those two tables**, and
this is the sharpest edge in the area. In `recipe_family_defaults` it is the
ordinary way of saying "pin the original". In `recipe_variants` it is
**damage** — the shape a variant is left in after being merged into its own
base, which is what `merge_recipe`'s guard (`20260815000001`) exists to detect.
That is precisely why the pin is its own table rather than an `is_default`
column on `recipe_variants`: the base has no join row, and inventing legitimate
rows of the damaged shape would retire the only signal that tells damage apart.

A pin on a VARIANT requires that variant to be saved (the validate trigger
refuses otherwise), because an unsaved variant is exactly what the orphan sweep
is free to delete — a preference whose target can vanish is worse than no
preference. Un-saving a variant retracts its pin, by trigger.

### The reuse shortcuts must re-check the blacklist

`promote` has two of them — `findBySuggestionId` (already promoted) and
`findByCanonicalName` (dish already in the catalogue) — and both hand back a
recipe written for **somebody else's request**. They were built to answer "have
we already paid to generate this dish?", for which a name match is the whole
answer. A blacklist is the input that makes the right dish the wrong recipe.

`decideReuse` (`recipes/services/blacklist.ts`) searches the whole FAMILY, not
just the candidate, and that is where the value is: the first caller with a
peanut allergy pays for one adaptation and everyone after them is served the
variant that already exists — including that caller on their next promote. It is
what makes an adaptation idempotent **without storing whose blacklist it was
written for**; the ingredients are the record. It **fails closed**: a family read
that errors adapts rather than serves, because a needless adaptation costs one
LLM call and a wrong serve puts a blacklisted ingredient in front of someone who
said they cannot eat it.

Matching is by `ingredientCanonicalId` on both sides — never substring. "Butter"
must not match "butternut squash".

The two shortcuts then diverge, and the reason is what data survives:

- **`findByCanonicalName`** — the suggestion is still here, and its ingredient
  list was already written around this blacklist by the generator. So the
  ordinary generation path runs, from a clean list, and only the persist changes:
  `variantBaseId` is set and the result joins the existing family. It is
  **not** marked `source_suggestion_id` and the suggestion is **not** deleted —
  that column means "the catalogue recipe this suggestion became", and a
  per-user adaptation is not that. (Marking it would also give one suggestion two
  promoted recipes, which `findBySuggestionId`'s `maybeSingle()` would start
  erroring on.)
- **`findBySuggestionId`** — promotion already deleted the suggestion, so there
  is no clean ingredient list and no falling through. The recipe itself is the
  only source material, which makes the adaptation a *modification* of it:
  `adaptRecipeForBlacklist` runs the `modify` prompt with the restriction as its
  instruction. That prompt is now shared (`modify-recipe-prompt.ts`) rather than
  copied — it carries the rule that matters, *replace* a non-compliant
  ingredient rather than drop it, which is the difference between an adapted
  dish and the gutted one `GUTTED_DISHES` pins.

Both adaptations emit a `label` on the terminal frame, like `modify` does. The
row is an unsaved variant until the client links it in `recipe_variants`.

### `recipes.origin` — generated or imported

`'generated' | 'imported'`, NOT NULL default `'generated'`, check-constrained
(`20260815000003`). Written by `POST /rest/recipes/import` since
`20260815000005` — see "Imported recipes" below and `RECIPE_IMPORT.md` for the
client-facing contract.

**It is `origin` and not `source` because `source` is taken.**
`find_recipes_result.source` is `'recipe' | 'suggestion'` — which TABLE a feed
row came from — and the client orders on it. Two `source` columns on rows
flowing through the same function would read as correct in every diff.

`is_generated` is now DERIVED from it (`p_origin = 'generated'`) in both persist
RPCs. That flag has distinguished nothing since the baseline, which is why
`delete_orphan_generated_recipes` is defined and never scheduled; an import is
the first row a 30-day reaper must never touch.

### Imported recipes, and who owns a recipe at all

`POST /rest/recipes/import` reads a recipe off a photograph — a cookbook page, a
screenshot, a handwritten card — and saves it as the caller's own. The full
client-facing contract is `RECIPE_IMPORT.md`; what follows is the part that
constrains everything else in this repo.

**`recipes.created_by IS NULL` means the shared catalogue; a non-null
`created_by` means exactly one profile can see it.** That is the whole ownership
model (`20260815000005`). Generated and catalogue recipes keep `created_by NULL`
and behave exactly as they did — `modify` and `escalate` still write shared
variants — so this is an addition, not a change of policy.

`check (origin <> 'imported' or created_by is not null)` makes **imported implies
owned** true by construction. That is what lets every consumer scope on
`created_by` alone and never also test `origin`: one predicate repeated, rather
than two that have to agree.

**The rule is written once, as `recipe_is_visible(created_by)`, because it has to
hold in six places and a divergence between any two of them is a silent leak
rather than an error:**

| Surface | How |
| --- | --- |
| `recipes` RLS | `using (recipe_is_visible(created_by))` |
| `recipe_ingredients` / `_instructions` / `_tags` RLS | resolved through the parent recipe |
| `find_recipes` | its own WHERE clause — SECURITY DEFINER, so it never sees a policy |
| `search_recipes` | `created_by is null`; dedup is about the catalogue, whoever asks |
| API routes taking a recipe id | `callerMayReadRecipe` — these read as the service role |
| `GET /recipes/:id/share` | 404 for anything owned |

The API half is the one that looks redundant and is not: **every repository here
reads through `supabaseAdmin`, which bypasses RLS by design**, so a route that
takes a recipe id from the request and hands the row back has to apply the rule
itself. `modify`, `escalate`, `compose`, `chat` and `substitutes` all do, each
folding refusal into its existing not-found branch so "you may not read it" and
"it is not there" are indistinguishable. **A new route that loads a recipe by a
caller-supplied id must call `callerMayReadRecipe`** — nothing enforces that but
this paragraph and the audit below.

```bash
npx nx run @fridgeezy/database:check-recipe-visibility
```

builds a real owned recipe with real content and tries to reach it as `anon`
down every path a guest has. It does not read policy definitions back — a
predicate can be present and still wrong. Run it after touching any of the six.

Three consequences that are easy to undo by accident:

- **`recipes_dish_identity_difficulty_unique` no longer covers owned rows.** It
  is a statement about the catalogue (one canonical dish per cuisine per
  difficulty); an import is not a catalogue entry. Without the exemption the
  first user to photograph a lasagna gets a row and everyone after them gets a
  unique-violation on a dish the catalogue already has.
- **`/share` refuses an owned recipe**, with the same 404 a missing one gets.
  The route is open *because its caller is not the app*, so there is no session
  to compare an owner against and the choice is everyone or no one. Sharing an
  import needs a signed, expiring token minted through an authenticated route —
  do not "fix" it by opening the read.
- **An import gets no dish-signature embedding.** `fts` feeds `search_recipes`,
  which excludes owned rows by definition, so writing one would be an OpenAI call
  per import whose only reader has been told to ignore it.

The import path is also the reason `persist-recipe.ts` has a THIRD persist
function. `persistImportedRecipe` skips the reuse-before-persist shortcut
deliberately: that shortcut is right for a promotion (the dish is the
catalogue's, paying twice is waste) and catastrophic here, where it would discard
the user's page and hand back the app's own lasagna.

Known and accepted: `recipe_display_tags` and `recipe_dietary` are views without
`security_invoker`, so they see past the policies and expose an owned recipe's
TAG NAMES to anyone holding its id. Not its content. Changing that affects every
existing caller, `find_recipes` included, and belongs in its own migration.
