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
- `embed-ingredients|embed-units|embed-tags|embed-suggestions|embed-recipes`
  — all five run one script, `operations/generate-embeddings.ts <target>`. They
  backfill only rows missing a vector; append `-- --all` to re-embed everything,
  which is what you want after changing a text builder. `embed-ingredients` is
  the one to reach for after any bulk import: `seed-ingredients` embeds only the
  rows it creates, so anything the LLM added arrives without a vector and stays
  invisible to similarity matching until this runs.
- `embed-categories` — **not** that script. A category's vector is the CENTROID
  of its curated seed members (`operations/embed-category-centroids.ts`,
  `-- --dry-run` to see the shelves without writing), because the ingredient
  fallback compares an ingredient NAME against it: embedding the category's own
  label instead scored 65.2% against the adjudicator's own answers where the
  centroid scores 85.5%, and it is what filed Cloves, Saffron, Mussels and
  Pumpkin under Mushrooms in the live catalogue. Re-run it after editing the
  seed's categories.
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
- `classify-ingredient-component` — fills `ingredients.component_kind` /
  `component_dish`, which is what puts "Make it yourself" under an ingredient
  that is a dish in its own right (a béchamel, a pizza dough) and what the
  "Used in" rail on a component's own page joins through. Dry run unless
  `COMPONENT_APPLY=true`; `COMPONENT_ONLY=`, `COMPONENT_LIMIT=` and
  `COMPONENT_RECLASSIFY=true` narrow or repeat it.

  **Read the dry run before applying.** The prompt's whole design is to lean
  toward `bought`, because a false `dish` — "make your own soy sauce" — is the
  one failure a reader notices, and it discredits the marker everywhere it is
  right. The cheap check is to look at what it called a dish.

  Same two-path shape as the dietary classifier above: the API classifies each
  ingredient on create (`classifyNewIngredientComponents`) and both sides share
  one prompt, in `@fridgeezy/components`.

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

  Both pin the image model explicitly rather than taking the shared default —
  `gemini-3.1-flash-image` since 2026-09-13, matching it by decision rather than
  by inheritance. The pin is not about cost: these are generated once, ever, and
  shown on every launch, so the bill is under a dollar and they could afford any
  model. What it buys is that a cost-driven change to the shared default cannot
  silently re-render the launch screen in a different hand from the recipe cards.
  **So when that default moves, decide about these rather than following.**

  They are committed assets, so nothing regenerates them by accident — but the
  dark variants go through the low-key gouache path, which `art-direction`
  already flags as the untested edge of the 2026-08-19 medium change. On a new
  model that warning compounds: eyeball a re-run of `generate-app-icon` /
  `generate-splash` before committing its output.

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
fraction of a cent (~700 short rows through text-embedding-3-small — most of
them `embed-categories`, which embeds the seed's 466 ingredient NAMES to average
them, not the 20 category labels).

**`embed-categories` reads `ingredient-seed.json`, not the catalogue**, so it
belongs where it is in that list: it works on a database with no ingredients in
it at all, and running it before `seed-ingredients` is right rather than merely
tolerable.

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
`eval-step-structure`, `check-streaming-conformance`, `check-batch-dedup`,
`check-slot-frames`.

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

`check-batch-dedup` and `check-slot-frames` are the odd ones out and the
cheapest things here: no database, no LLM, no API key, they run in milliseconds.
Both protect **concurrency** properties, and a concurrency property that holds
"usually" is indistinguishable from one that holds.

`check-batch-dedup` drives the intra-batch dedup coordinator through the
interleavings the real stream produces — including four identical dishes
settling in reverse arrival order — because that is what put `Haemul Pajeon`
next to `Pajeon` in the first place. Run it after touching
`suggestion-batch.ts`.

`check-slot-frames` drives the batch feed's slot accounting, which has to hold
two things at once that pull apart: **slots are announced in whatever order the
gate calls return** (they have been measured from 0.67s to 5.53s within one
batch, and a count that waits on the slowest is wrong at the only moment anyone
reads it) while **cards go out in generation order** (the client renders an
ordered list). That is the whole reason `generate-suggestions-stream` is built
around a queue rather than one loop. Run it after touching that file,
`slot-ledger.ts` or `frame-queue.ts`.

### Accent folding: a fold written twice, in two repos

Every searchable text column has an accent-folded twin —
`recipes.name_ascii`, `recipe_suggestions.description_ascii`,
`ingredients.name_ascii`, `tags.name_ascii` and the rest — as a **stored
generated column** over `public.fold_accents()`
(`20260825000001_accent_folded_search.sql`).

They exist because the CLIENT searches this database directly. Its catalogue
search is a PostgREST `ilike` straight at these tables, and PostgREST cannot
call a function on the column side of a filter, so the fold has to be
materialised — an expression index would speed up a predicate the client has
no way to write. Before this, "bechamel" missed "Béchamel Sauce" and the
browse screen reported it as a dish the catalogue does not hold; same for
Soufflé, Salade Niçoise, Pâté en Croûte, Moules Marinières and Supplì.

**The fold is written twice and the two copies must agree.** `fold_accents()`
here folds the row; `foldAccents()` in the client's `shared/toolkit` folds the
query. A divergence raises nothing — it just makes some dishes quietly
unfindable, which is the bug this closed.

That is why it is `normalize(NFD)` plus a strip of U+0300–U+036F and **not
`unaccent`**: it is the one fold Postgres and JavaScript both implement
natively and identically. `unaccent` folds further (ø→o, æ→ae, ß→ss), which
JavaScript would not, so it would disagree on exactly those characters. The
coverage that costs is a Danish or German dish still needing its own letters
typed — no worse than before. **Widen both sides in one change or neither.**

Two properties callers lean on: the fold is **length-preserving** for
precomposed text, which is what lets the client's `HighlightedLabel` slice a
match out of the ORIGINAL string at an index found in the folded one; and it
**does not lowercase**, because `ilike` already handles that.

A generated column cannot be inserted into, so anything that round-trips rows
has to skip these — see `SKIP_COLUMNS` in `backup-ingredient-tables.ts`, where
`name_ascii` sits beside `embedding` for a stricter reason than size.

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
apps/admin        Admin console (React + Vite) — exported to S3, see "The admin console"
apps/site         Static marketing/legal pages — exported to S3, see "The public site"
infra             Terraform for the Lambda deployment + the site's S3/CloudFront
libs/admin-contract     Wire contract for /rest/admin — NOT packed for the client
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
| `POST /rest/ingredients/extract` | `modules/ingredients` — **premium** |
| `POST /rest/suggestions/generate` | `modules/suggestions` — **premium** |
| `POST /rest/suggestions/:id/promote` | `modules/suggestions` — **premium** |
| `POST /rest/suggestions/resolve` | `modules/suggestions` — **premium** |
| `POST /rest/recipes/generate` | `modules/recipes` — **premium** |
| `POST /rest/recipes/difficulty/escalate` | `modules/recipes` — **premium** |
| `POST /rest/recipes/modify` | `modules/recipes` — **premium** |
| `POST /rest/recipes/import` | `modules/recipes` — **premium** |
| `POST /rest/recipes/:recipeId/adapt` | `modules/recipes` — **premium** |
| `POST /rest/recipes/:recipeId/compose` | `modules/recipes` — **premium** |
| `POST /rest/recipes/:recipeId/chat` | `modules/recipes` — **premium** |
| `GET /rest/recipes/:recipeId/share` | `modules/recipes` — **open** |
| `POST /rest/substitutes/generate` | `modules/substitutes` — **premium** |
| `POST /rest/chat` | `modules/chat` — **premium** |
| `POST /rest/speech/command` | `modules/speech` — **premium** |
| `POST /rest/speech/synthesize` | `modules/speech` |
| `GET /rest/prompts` | `modules/prompts` |
| `POST /rest/prompts` | `modules/prompts` |
| `DELETE /rest/prompts` | `modules/prompts` |
| `DELETE /rest/prompts/:id` | `modules/prompts` |
| `POST /rest/billing/revenuecat` | `modules/billing` — **open** |
| `GET /rest/health` | direct — **open** |
| `* /rest/admin/*` | `modules/admin` — the admin console, behind `requireAdmin` |

**Premium** means the route requires an active subscription
(`requireEntitlement`, 402); **metered** means a free account may reach it a
fixed number of times a month and then gets the same 402 (`requireQuota`). As of
2026-09-03 the split is 2 premium (`/suggestions/generate`, `/speech/command`)
and 12 metered — the table above still says "premium" throughout and is the one
place that has not been reworded, so **read the startup banner rather than that
column**: it derives both marks from the handler stacks. See the entitlement and
allowance sections below.

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

### The entitlement row is reconciled, not just received

`profile_entitlements` had ONE writer — the webhook — so it was also the only
thing that could ever be wrong, and nothing re-asked. The derived activity rule
(`entitlement_is_active`) self-heals at the expiry the last event happened to
carry, which is the right guard against a dropped EXPIRATION and no guard at
all against a row whose expiry is simply wrong.

`reconcileEntitlement` (`modules/billing/services`) reads
`GET /v1/subscribers/{app_user_id}` and writes what RevenueCat actually says.
Three triggers, each bounded so the common path costs nothing:

- **`stale`** — the row claims access and has not been verified inside
  `VERIFY_TTL_MS` (15 min). Only for users who HOLD an entitlement, from both
  `requireEntitlement` and `requireQuota` — the latter because
  `ai_quota_status` joins `ai_quota_limits` on the derived tier, so a stale row
  hands out the subscriber ceiling to somebody who has lapsed.
- **`refused`** — immediately before a 402, and only for a caller with no active
  row. This is the purchase-to-webhook window: somebody who paid two seconds ago
  is entitled at RevenueCat before the event arrives.
- **`requested`** — `POST /rest/billing/reconcile`, which the app calls from the
  RevenueCat SDK's customer-info listener. **The device is a trigger, never a
  source**: it sends no body and names no entitlement, and what is written comes
  from RevenueCat — which is what lets the route sit on an `account` mount with
  no gate. It has to be ungated: the caller may be somebody whose subscription
  has just LAPSED, and that is the one request that can correct the row.

Four things bite:

- **`REVENUECAT_SECRET_API_KEY` is the off switch, and that is deliberate rather
  than a flag.** Unset, nothing reconciles and the behaviour is exactly what it
  was. It is the v1 SECRET key, not the app's public one. The startup banner
  names which mode the process is in.
- **A gate never fails because of it.** `refreshEntitlement` swallows and
  returns the row it was handed — a verification that could not be made is not
  evidence about anybody's subscription, and turning a RevenueCat outage into a
  refused paying customer is the one failure this must not introduce.
- **It does NOT touch `last_event_id` / `last_event_at`.** Those belong to the
  webhook's ordering guard; a reconciler that stamped them would start rejecting
  real events that legitimately follow it. `saveVerifiedEntitlement` is a
  separate write from `applyEntitlementEvent` for exactly this reason: one
  applies NEWS and must respect ordering, the other applies TRUTH and must not.
- **It expires a fabricated local row.** `infra/send-webhook-event.sh` writes
  entitlements with no purchase behind them, which is the only way to hold one
  locally (RevenueCat delivers webhooks to one deployed URL, so a local stack
  never receives one). With the key set, the first check correctly expires it.
  Leave the key unset locally when you want a subscription to test WITH.

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
guesses wrong, and invalidates. The share page is dynamic and stays on the
Lambda, reached through the one API behaviour on this distribution: `/r/*`,
rewritten to `/rest/recipes/:id/share`, which is the link the app shares and the
path its universal links claim. **`/rest/*` was deliberately left off** — the
Function URL is `RESPONSE_STREAM` and the app's SSE traffic has no reason to
cross CloudFront; `site.tf`'s header carries that argument. `apps/site` also
writes `.well-known/apple-app-site-association`, which is why the viewer-request
function exempts that prefix and why `deploy-site.sh` pushes it with its own
content type.

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

**It is attached per MOUNT, via `tier`** (2026-08-26). The product's rule was one
sentence — **if a model runs, it is paid** — and since 2026-09-03 it is two:
**if a model runs it is paid, but a free account gets an allowance of it first.**
The tiers are:

| Tier | Gets |
| --- | --- |
| **guest** | the catalog, read straight from Supabase — never reaches this API |
| **account** | `POST /speech/synthesize`, `/prompts`, `/account`, `/billing` — and `/admin`, which is not free in the sense the others are: it costs nothing a READER would be billed for, and carries a gate of its own |
| **metered** | reachable N times a month by a free account, then 402 — every route under it carries `requireQuota` (see below) |
| **subscriber** | `/suggestions/generate` and `/speech/command`, plus `/recipes/:id/personalise` when it lights up |

### A stored storage URL carries a HOST, and that host can be somebody's laptop

Found in production on 2026-09-23 and repaired the same day: **49 of 54
recipes** carried
`http://192.168.1.6:54321/storage/v1/object/public/recipes/<dish>.webp` in
`recipes.image` — a developer's LAN address, in the shared catalogue. Every
share link served it as `og:image` and as the page's `<img>`, so every preview
in iMessage, WhatsApp and Slack had been broken for as long as the rows existed;
and because the app reads `recipes.image` straight from Supabase and
`find_recipes` returns it, the catalogue had no pictures in the app either.

**It was invisible for exactly the reason it was possible.** On the developer's
own phone, on the same Wi-Fi, with the local stack up, `192.168.1.6:54321`
resolves and every picture loads.

- **The bytes were never wrong.** All 94 objects — 47 dishes, hero plus card
  variant — were in the production bucket under exactly the right keys, and the
  canonical URL returned 200. Only the stored host was wrong, which is what
  made this a URL rewrite rather than 47 regenerations.
- **The API cannot have written them.** `toDeviceReachable` swaps loopback for
  the Mac's LAN address on a storage URL about to reach a phone — a no-op in
  every deployed configuration by construction, since Lambda's `SUPABASE_URL`
  is the project's https origin and has no loopback host to match. And it
  DERIVES from `SUPABASE_URL`, so the host in the URL and the database being
  written are always the same machine. **A private host cannot be written into
  production; it can only be copied there** — a dump and restore, or a seed
  built from a local stack. Nothing in the code path can prevent that, which is
  why what was added instead is the ability to SEE it.
- **`npx nx run @fridgeezy/database:repair-image-urls`** is the fix. Dry run by
  default, `--remote` to reach the deployed project, `--apply` to write; it
  prints the target host in every mode and proves each object exists before
  repointing its row. `apps/database/.env` only ever holds local values on
  purpose, so this builds its own client from an explicitly named target rather
  than inheriting one.
- **The console reports it**, as "Unreachable art" on the Overview beside "No
  illustration", linking into `/recipes?unreachableImage=true`. Kept a separate
  count from the missing-illustration one deliberately: the two look identical
  to a reader — no picture — and are opposite jobs. One needs a generation; this
  needs a string replaced.
- **It reads 0 against a LOCAL stack and that is correct**, not a broken
  filter. There a private storage host IS the stored value and it resolves, so
  there is nothing unreachable to report. The count only means something for a
  database the public is served from.

#### Which Google account the console's images are billed to

Both art screens spend money on `generateImage`, and `libs/genai` already
chooses between two backends by which variable is set: `GOOGLE_API_KEY` is the
Gemini API in AI Studio, `GOOGLE_CLOUD_PROJECT` is Vertex, and **only IMAGE
generation moves** — speech stays on the key because the TTS models this repo
pins are not served by Vertex.

**The point is billing.** AI Studio cannot be paid for with Google Cloud
credit; Vertex bills as an ordinary Cloud service and can. `apps/database/.env`
has had the project for the CLI operation since it was written;
`apps/api/.env` did not, so everything the console drew went to the prepay
balance. It has both now, and `imageGenai()` does the rest — **no code in the
admin module chose a backend and none should**.

- **The switch is process-wide for images.** Setting it on the API moves the
  console's step and technique art AND the hero art on the generation path.
  That is more credit used rather than a side effect to avoid, but it is worth
  knowing before it is set on the deployed function.
- **Credentials are NOT configured with it.** `google-auth-library` resolves
  them itself — `GOOGLE_APPLICATION_CREDENTIALS`, then gcloud's
  application-default login, then a metadata server — so a laptop that has run
  `gcloud auth application-default login` needs nothing further. That is why
  local worked the moment the project was set.
- **Lambda has none of those three**, which is why `load-secrets.ts` grew
  `materialiseGoogleCredentials`: every other SSM parameter becomes an env var
  of the same name and is done, but `GOOGLE_APPLICATION_CREDENTIALS` is a PATH.
  A `GOOGLE_SERVICE_ACCOUNT_JSON` parameter is written to
  `/tmp/google-service-account.json`, the variable is pointed at it, and the
  JSON is deleted from the environment — it is a private key, and an env var is
  the thing most likely to end up in a stack trace. Absent, nothing happens and
  images stay on the API key.
- **A failed write is not fatal.** Falling back to the API key is a billing
  surprise; taking the API down over it turns one wrong invoice into no
  service.
- **Both art screens SAY which budget they spend**, beside the price rather
  than in a settings page — `BillingBadge`, from an `ImageBillingPath` the two
  endpoints report. Vertex is drawn as the quiet state and AI Studio as the
  loud one, which is the opposite of a usual status badge: Vertex is where
  these screens are meant to be, and falling back is the case worth noticing
  because it is invisible in every other way — the render succeeds, the picture
  is identical, and the wrong account pays. The same line goes into the log
  with every spend, the way `generate-step-art.ts` prints it.

#### Technique art (`/operations/techniques`)

The other half of Operations, and a much better bargain than step art. Same
shape — pick what to draw, see what it costs, press — and the arithmetic is the
opposite way round:

| | step art | technique art |
| --- | --- | --- |
| Keyed on | a recipe's steps | a row in `cooking_actions` |
| Total possible cost | unbounded, ~$0.54 per dish forever | **~$9.92, once, for all time** |
| Today | off by default | drawn on FIRST REQUEST |

**What is being bought is a WAIT, not a picture.** `/rest/techniques/illustrate`
is free to any signed-in account precisely because the vocabulary is closed —
148 rows, and the service refuses anything outside it, so a 149th distinct
request cannot exist. What that free route does NOT avoid is the first reader of
each verb waiting at a hob for a render to learn what "deglaze" means. Drawing
the set retires that permanently. 9 of 148 were drawn when this shipped.

- **It calls the app's own generator**, `getOrGenerateTechniqueArt`, which owns
  the prompt, the 4:3 framing, the white-ground correction that lets one
  backdrop sit behind every plate, and the refusal of unknown verbs. A console
  that drew these itself would be a second copy free to drift — and the drift
  would show as two techniques in two styles inside one sheet.
- **`force` was added to that generator** for the same reason step art needed
  it: the short-circuit is what makes the reading path free after 148 requests,
  and it refuses the only thing a curator asking for a redraw wants. Default
  false, so the app's path is unchanged.
- **A batch is capped at 12 and the cap is timing, not taste.** A render is
  ~10s at three concurrent, so twelve is ~40s — inside Lambda's 300s. All 139
  at once is eight minutes and a timeout. The console presses it repeatedly,
  which also keeps the spend visible a batch at a time rather than arriving as
  one number at the end.
- **The UI picks the batch; the server draws exactly what it is given.** A
  "draw the next N" route would have the server choosing what to spend money on,
  and the console could not put the price on the button before it was pressed.
- **One failure does not discard the batch.** The generator throws — on a model
  that answered with text, on a failed upload — so each verb is caught and
  reported against its own name. Eleven paid renders must not be lost to a
  twelfth.
- **A grid, not the rows step art uses.** These are 148 single words with a
  picture each and no sentence to read beside them; the picture IS the content.
  The tile ground is white rather than the page's cream, matching what
  `normaliseGround` corrects every render to — a tinted tile would hide the one
  defect worth spotting, a plate whose own ground drifted.

#### The sidebar is grouped, and Operations is the one that spends

**Insights** reports, **Catalogue** is the shared corpus a reader sees,
**Accounts** is people, **Operations** is work that costs something to run.

"Catalogue" rather than "Entities" or "Database" deliberately: those are
implementation vocabulary, and the app already has a word for this. A console
that names its sections after tables teaches its reader the schema instead of
the product. Accounts sits on its own rather than being filed under Catalogue
because a person is not catalogue content, and lumping them together is how a
tool starts treating readers as rows.

**Only the first three carry counts, and every count is a DEFECT.** A badge
beside Operations would read as a backlog, and an undrawn step method is not
one — see below.

#### Step illustrations (`/operations/step-art`)

Per-step cook-mode art, drawn for a dish you choose. **The most expensive thing
in this console by an order of magnitude**: ~$0.067 a render against six to
twelve steps, so $0.40-$0.80 for a method, against ~$0.067 for a dish's hero.

- **`RECIPE_STEP_ART_ENABLED` does NOT gate it, and must not.** That flag
  governs drawing art AUTOMATICALLY for every dish the app writes, which at
  this price is indefensible — its own note says so. Choosing a handful of
  dishes by hand is the opposite decision, and it is the one
  `operations/generate-step-art.ts` already makes from the command line: "a
  decision a person makes about a dish rather than a flag a deployment sets".
  A console button that silently did nothing because a deployment variable was
  unset would be worse than no button.
- **`renderRecipeStepArt` is the shared pool**, extracted from
  `generateRecipeStepArt` rather than copied. The automatic path keeps the flag
  and delegates; the console reaches the shared function directly. Two copies
  of a render pool is two places for the concurrency limit to drift.
- **It SKIPS a step that already has a picture unless `force` is passed.** The
  automatic path never needed that — it fired once per recipe at creation, and
  `renderStep` uploads with `upsert: true` without looking — and it becomes
  wrong the moment a human can press the button twice. "Draw missing" is
  therefore free to press repeatedly; "Redraw" is the one that costs.
- **The bucket IS the record.** No column says a step was drawn, so both the
  read and the skip check list `recipe_step_art/<recipe_id>/` once — the same
  shape `recipe-art.ts` uses for heroes, and the same reason: a probe per step
  is a dozen requests to draw one screen. A URL is returned only for a step
  whose object exists; it is derivable for any step at all, so returning it
  unconditionally would put a broken `<img>` on every undrawn step.
- **Every button carries its price in the LABEL** — "Draw 4 missing · $0.27" —
  rather than in a confirmation. A dialog that appears after the reader has
  decided is a thing to click through; a number on the button is part of the
  decision.
- **The cost REPORTED counts attempts, not successes.** A failed render still
  cost a call, and a skipped one cost nothing. It is the only version of the
  figure that cannot understate a bill.
- **The art slot is 4:3**, the ratio the renders are asked for and the band cook
  mode draws them in. A different ratio here would make the console a poor place
  to judge whether a picture is any good, which is the only reason to look.
- **It is a BROWSER, and that is a reversal.** It opened on a search box, on
  the argument that the dish is one somebody already has in mind. That is true
  of half the visits: the question this screen actually gets asked is "which
  dishes have NO step art", which is a filter over the catalogue rather than a
  lookup. `GET /rest/admin/step-art/recipes` answers it, the method opens BELOW
  the list so working through several is scrolling rather than navigating, and
  every row carries the price of FINISHING that dish.
- **The filter runs server-side off ONE storage listing.** Keys are
  `<recipe_id>/<step>.webp`, so the bucket root's entries are exactly the
  recipe ids with at least one picture — which makes "has none" and "has some"
  answerable for the whole catalogue in a single request, and therefore
  expressible as a PostgREST filter before paging. There is deliberately no
  "partly drawn" filter: that would need a listing inside every recipe's folder
  across the catalogue. The precise `3 of 8` is per-ROW and costs a listing only
  for the rows on this page that are in the set at all — today, almost none.
- **Hidden dishes are excluded outright** rather than offered as a filter.
  Paying $0.40 to illustrate a method no reader can reach is the one mistake
  this screen should make impossible.
- **Selecting a dish SCROLLS to its method, and three separate things had to
  be right before it did.** The panel sits below the list — which is correct,
  it keeps your place while you work through several dishes — and that is what
  made selecting look broken: 25 rows is about 2,300 pixels, so the press
  changed something nobody could see.
  - **`behavior: "smooth"` is a silent no-op** in some browsers and contexts.
    Measured: 0px of movement from the same call that moves 2,336px with
    `auto`, same element, same page, no error and no warning. It cannot be
    feature-detected — the call returns void either way. Instant is also the
    right interaction for this distance, and it is the reduced-motion answer,
    so there is no branch.
  - **`requestAnimationFrame` NEVER RUNS in a hidden tab.** rAF is tied to
    painting and a browser suspends painting for a tab that is not visible —
    measured as `visibilityState: "hidden"`, `rafFired: false`,
    `timeoutFired: true`. It was being used as "after React commits", which it
    is not: an effect is, and React runs one whether or not anything is
    painted. **Do not reach for rAF to sequence work after a render.**
  - **The scroll target has to stop MOVING first.** Arriving by URL scrolled
    80px: the method and the list are two requests, the method usually wins,
    and at that moment the list is empty — so the panel sits near the top of a
    short page. The list then lands, grows the page by two thousand pixels and
    carries the panel away. The arrival scroll therefore waits for BOTH reads;
    a press does not, because the list is already there.
- **The GATHERING PAGE is a first-class slot** (2026-09-23). It costs the same
  render, lives in the same bucket under the same key shape, and is drawn or
  missing exactly like a step — so it leads the list, which is the order a cook
  meets them: the bench before step one.

  What it is NOT is a step. It has no `recipe_instructions` row and no number,
  which is why `StepArtSlot` is `number | "mise"` — the same sentinel
  `generate-step-art.ts` has always used, shared rather than re-invented so one
  object key means one thing across all three callers. Its `instructionText`
  carries the INGREDIENT LIST it will be drawn from, because there is no
  sentence, and the row is washed peach with no number so it reads as separate
  before it is read at all.

  - **A different prompt and different references.** `buildMiseArtPrompt` takes
    the ingredient NAMES — never quantities, because servings are adjustable and
    a picture drawn around "two cucumbers" is wrong for everybody who changed
    the number — plus TWO reference images whose order is load-bearing:
    `generateImage` puts them before the text in array order, so the clause's
    "the FIRST" and "the SECOND" are claims about the payload. The list of names
    and the list of images are built from one condition for that reason.
  - **The gathering anchor had to move into storage.** The CLI reads it from
    `operations/data/mise-anchor.webp`; the API cannot, so the same image is
    uploaded to `art_direction/mise-anchor.webp` and read by `fetchMiseAnchor`.
    **Replace them together** or the console and the command line start drawing
    two different benches. It is deliberately NOT added to `ANCHORS`: that set
    teaches a PLATED dish's register and is meaningful as a set, where this one
    teaches a bench — adding a seventh that shares a different thing changes the
    claim for every hero too.
  - **Both anchors degrade to null rather than throwing.** A gathering page
    without them is what every one drawn before references existed was; a
    gathering page that failed is a hole in the method.
  - **`NUMBERED_STEP` is still needed in the BROWSER's count.** `mise.webp` sits
    beside `1.webp`-`7.webp`, and counting every object there reported "8 of 7
    drawn" — a number that cannot be true, on exactly the dishes that had art.
    The browser column counts numbered steps; the detail page counts slots,
    including mise. The two answer different questions and neither is the other.
  - KNOWN AND ACCEPTED: a folder holding ONLY a mise picture counts as "has
    some" in the browser's filter, so such a dish is missing from "no step
    illustrations". Telling that apart means the per-recipe listing the root
    listing exists to avoid.

#### "No illustration" asks STORAGE, not the column

`missingImage` shipped as `image IS NULL` and could never match. Persistence
stores a PREDICTED url derived from the dish's name without waiting for the
upload — deliberately, so a save is not blocked on a render — so the column is
non-null for essentially every row ever written, including those whose upload
never landed. Production proved it: `missingImage: 0` on a catalogue that
contained a dish with no object in the bucket at all.

It now lists the bucket ONCE per request and compares each row's object key
(`services/recipe-art.ts`). Four things about that:

- **The key comes from the stored URL, not re-derived from the name.** They
  agree today and stop agreeing the moment a dish is renamed, at which point
  re-deriving would report missing a picture that is sitting there under its
  old key. The URL is what a reader's browser actually fetches.
- **An unreadable listing reports NOTHING, never everything.** `usable: false`
  on a storage error or on hitting the 1000-object cap, because the alternative
  is marking the whole catalogue as missing art on a hiccup.
- **The filter resolves ids first and hands them back as an `in`**, so paging,
  the count and the sort stay server-side. Bounded by that filter's own
  ceiling — PostgREST puts it in the query string, refused past roughly 250
  ids with a 414 — which is the same trade `listTags` records for its usage
  sort.
- **The Overview count and the filter share the predicate**, so the tile and
  the list cannot disagree about which dishes are affected.

**And the flags are not `z.coerce.boolean()`.** Coercion is `Boolean(value)`,
and `Boolean("false")` is `true` — so `?missingImage=false` APPLIED the filter.
It survived because the console only sends the parameter when a box is ticked,
which is luck rather than design: a bookmark or a link would hit it at once.
`FlagSchema` in `@fridgeezy/admin-contract` is the replacement and every
checkbox filter uses it.

**The rule is private-vs-public, never "differs from the origin we expect"**,
and `isPrivateHost` / `isPubliclyServed` (`@fridgeezy/toolkit`) exist so the
repair and the console cannot disagree about it. The origin comparison is the
obvious test and it is wrong in the case that matters: on a local stack
`SUPABASE_URL` is loopback while the stored URL deliberately carries the LAN
address, so comparing origins flags every correct row — and "repairing" them to
`127.0.0.1` would break image loading on every physical device, which is the
exact bug `toDeviceReachable` exists to prevent. Both drafts of the repair made
that mistake before the local dry run caught it. A local run is now a no-op by
construction, and the console's count is 0 there for the same reason.

**One row is left broken on purpose**: Peking Shredded Pork has no object in the
bucket at all, so there is no URL to repair. It needs its illustration
regenerating, which is a button in the admin console.

### Food safety is a prompt rule, and it outranks the cook

`FOOD_SAFETY_RULES` (`modules/recipes/services/food-safety-rules.ts`) is shared
by the four instruction-AUTHORING prompts — `promote`, `generate-recipe`,
`escalate-difficulty` and `modify-recipe` — the same way `TEMPERATURE_RULES` is,
and for a sharper reason: two of those four REWRITE a method that was generated
clean, and what they would undo here is a cooking temperature rather than a
unit.

Before 2026-09-23 **no prompt in this repo mentioned food safety at all.** The
only constraint on a doneness instruction was `TEMPERATURE_RULES`, which governs
which UNIT a number is written in and says nothing about the number — so nothing
stopped a generated recipe finishing chicken on a visual cue, giving a
slow-cooker method for dried kidney beans, or building a hollandaise on raw eggs.

- **It is NOT in `read-recipe-from-image`**, which is the fifth consumer of the
  shared blocks. Import is TRANSCRIPTION: the cook photographed their own book,
  the row is written with `created_by` set and is private to them, and the job
  is fidelity. A rule that raised a temperature there would silently rewrite
  somebody's grandmother's recipe and present the edit as the original — a worse
  failure than the one it prevents, because nothing shows it happened.
- **It outranks the cook's own instruction**, which is why it is in the two
  rewriting prompts. "Make it quicker" is the case that matters: the cook time
  on a chicken IS the safety margin, and a model asked to compress it has no
  reason not to.
- **Two clauses offer a CHOICE of mitigation, and that is not softness.** Dried
  kidney beans may be hard-boiled or simply tinned; raw egg may be cooked to
  71°C or bought pasteurised. A rule with one route makes the model choose
  between obeying this block and obeying something else — which is exactly what
  the first draft did, and `food-safety.eval.ts` caught it: it demanded
  "pasteurised eggs" in the INGREDIENT LIST, contradicting three older rules in
  `generate-recipe` (use only the given ingredients, use their exact names, put
  qualifiers in `comment`) that exist because ingredient names are matched
  against the catalogue. The model obeyed the older rules — correctly — and
  scored 0/2 on Eggs Benedict while every other dish passed. **A safety rule
  that fights the pipeline loses, silently.**

**Measured**, five dishes chosen to trigger one clause each, three runs apiece
on gpt-4.1: hazard removed in **3/15 without the block and 13/15 with it**,
while safety mentions per step went 10% → 17% — it puts a temperature in the
right step rather than turning every step into a warning. The known weak case is
hollandaise at 1/3; the file's own header carries why, and why chasing it on an
n=3 sample is the wrong move.

```bash
npx nx run @fridgeezy/api:eval-food-safety                          # both variants
npx nx run @fridgeezy/api:eval-food-safety -- --repeat=3 --only=b_safety
```

The eval builds its baseline by CUTTING the block out of the shipped prompt,
since it is already wired in — and refuses to run if that removal changes
nothing, because two identical variants score identically and the natural
reading of that is "the rules make no difference".

**It also loads `.env` and `.env.dev` through `evals/load-env.ts`**, which is a
side-effect module rather than three lines at the top of the eval: imports are
evaluated before any statement in the importing file, so a `config()` call
anywhere in the body runs after `@fridgeezy/supabase` has already thrown on a
missing `SUPABASE_URL`. The older evals in that directory read `.env` alone and
so only run for somebody who has merged the two files by hand.

### The admin console (apps/admin)

A React + Vite SPA on its own S3+CloudFront distribution at
**admin.fridgeezy.com**, talking to `/rest/admin/*` on the existing Lambda.
Six screens: an overview, recipes (edit, hide, repaint, delete), suggestions,
ingredients, tags and users. Added 2026-09-22.

**There is exactly one gate and it is `requireAdmin`**
(`modules/admin/services`). It runs behind the mount's `requireSupabaseUser`,
reads `profiles.is_admin` against the id that verification produced, and
answers a non-admin **404 rather than 403** — there is nothing for them to act
on, and nothing to gain by confirming the surface exists. Four things about it:

- **The flag is read per request, not carried in the token.** A custom JWT
  claim would save a round trip and would also be minted at sign-in, so
  revoking an admin would take effect whenever their access token happened to
  expire. Same trade `requireSupabaseUser` records, on the connection that one
  already opened.
- **It does NOT stand down for `ALLOW_UNAUTHENTICATED`.** That escape hatch
  leaves no user id, so every admin request is refused under it. A local
  console therefore needs a real session and a real flag, which is what
  production needs. A gate that turns itself off on an environment variable is
  one variable away from being no gate.
- **`is_admin` is not client-writable, and RLS could not do it.** Policies
  govern rows, never columns, and `users_update_own_profile` lets a caller
  write their own row — so the column would have been one PATCH away from being
  set by the person it governs. `20260922000001` revokes the table-wide UPDATE
  grant on `profiles` and re-issues it column by column. **Anything added to
  that table from now on is un-updatable by the client until it is named in
  that grant**, which is the right direction to fail in.
- **The console never reads Supabase directly.** Its client holds the anon key
  and is used for one thing: signing in. Every row comes from the API as the
  service role, which is why the anon key sitting in a public bundle is worth
  nothing.

#### It is built on MUI, and the theme is what keeps it ours

`@mui/material` (+ emotion) since 2026-09-23, on the owner's call. The console
was hand-rolled controls on a 520-line stylesheet, and what that cost was
visible in the CONTROLS rather than in the layout: a `<select>` with the
browser's own arrow, a checkbox nobody had styled, a dialog with a
hand-written focus trap, a toast with a hand-written timer.

**The library is here for behaviour, not for appearance.** Everything it brings
is something that was going to be written badly by hand: a real select, a
dialog that traps focus and restores it, a table header that sorts and carries
`aria-sort`, a snackbar with a live region, a field with a label and a helper
line that line up. The LOOK is `theme.ts`, which is long on purpose — stock MUI
is Roboto on white with a blue accent and a shadow on everything, and a console
that looked like that would be a second brand.

- **`TOKENS` in `theme.ts` is the second copy of the palette and there are only
  two.** `styles.css` declares the same values as custom properties for what is
  left of the stylesheet; every `sx` reads `TOKENS`. Change a colour in both.
- **What MUI owns**: buttons, fields, selects, checkboxes, tables, chips,
  dialogs, the snackbar, the progress bar, alerts. **What the stylesheet still
  owns**: the shell's grid, the sidebar, the wordmark, page heads, art
  thumbnails, and the composite blocks that are layout rather than widgets (a
  step row, the technique grid, the save bar). Moving the frame into `sx` as
  well is the tempting next step and it would put the console's layout into
  eight files instead of one.
- **Three Material defaults are turned OFF and each was a decision**: uppercase
  button labels (this product writes "Email me a code"), the elevation ramp
  (a card here is separated by a hairline outline and the warm ground, not by a
  shadow — `shadows` is the app's own three), and the ripple (a press is
  acknowledged by a tint, which is the app's `tint` tier; an expanding circle
  is a second vocabulary for one event).
- **`spacing` is 4, not Material's 8**, because the app's grid is four-point.
  Every `sx={{ mb: 4 }}` in this console is 16px.
- **The bundle went from ~64KB to ~243KB gzipped.** Stated rather than hidden:
  it is an internal tool one person opens on a desktop, the assets are a year
  cached, and what was bought is every control above. It would be the wrong
  trade in the phone client, which is why that one still has none of this.
- **`autoFocus` inside a `Dialog` does not work and is not the fix.** The
  dialog's focus trap takes focus to the paper when it mounts, AFTER React has
  applied `autoFocus`, so the reader lands on a `<div>` and their first
  keystroke goes nowhere — measured, not assumed. `ConfirmDelete` focuses its
  field from `slotProps.transition.onEntered`, which is also the moment the
  dialog has finished travelling.
- **MUI restores focus to the opener, and the one case it cannot is worth
  knowing**: if the page re-renders that button away while the dialog is open
  (a mutation's `reload()` behind it), the node it restores to is detached and
  focus falls to `<body>`. It is not worth code; it is worth not being
  surprised by.
- **The hand-rolled dialog's two bugs are gone with it**, and they are recorded
  because they are what the library is being paid for: the opener had to be
  read during RENDER (an effect-time read captures the dialog's own field), and
  the restore had to be scheduled a tick late so StrictMode's double-invoked
  effect could cancel it.

#### It looks like the app, and the serif is the whole of that

Light only (owner's call, 2026-09-23) — the dark set is deleted rather than
left following the system. The app carries a stored preference because a cook
holds a phone in a dark kitchen; a desktop tool for curating a cream-grounded
catalogue has no such argument, and half the reason to open this screen is to
judge a painting whose ground is baked in. Reinstating it means lifting the
block back out of `chrome.ts`, not inventing one.

Otherwise the tokens are the site's, copied — same names, same values — because
a console with a palette of its own is how one product ends up with two brands.
The ground is the APP's `#FCFAF6` rather than the site's, which is the 10% warm
blend the owner settled on after two fuller-warmth attempts were reverted.

**Lora appears on a DISH'S NAME and nowhere else**, which is the client's own
rule ("the serif is reserved for a dish's NAME") applied rather than a
decoration. Recipe rows, suggestion rows and the detail page's masthead take
it; page titles, section headings, table headers, ingredient names and tag
names are chrome and stay in Poppins — the same split the app reached when its
empty pages and welcome screen moved from serif to sans. Spreading it further
reads as "more branded" for a day and then the one signal that says *this row
is a dish* is gone.

- **The faces are self-hosted**, converted from `@expo-google-fonts/lora`'s
  TTFs and subset to Latin + Latin-1 + Latin Extended-A. That range is not
  optional: dish names are Béchamel, Ragù, Niçoise and Gougères, and a subset
  that dropped the accents would fall back mid-word. 130KB TTF → ~21KB woff2
  each.
- **Section headings are the app's quiet-heading idiom** — 11px, tracked,
  uppercase, muted ink — not a bold 17px, which competes with the page title
  two ranks above it.
- **A row's hover is the peach wash**, not a neutral grey: a tint is the app's
  hover and selection treatment everywhere, and grey on a white card reads as a
  disabled row.
- **Thumbnails are 3:4**, the ratio every illustration is rendered at. A square
  crop takes the sides off the plate, which is exactly why the app's own recipe
  row holds its picture in a 3:4 frame.

**Granting the first admin is a SQL statement, deliberately.** There is no
bootstrap route and there should not be one:

```sql
update public.profiles set is_admin = true
 where user_id = (select id from auth.users where email = 'you@example.com');
```

After that the console's Users screen can grant and revoke. **An admin cannot
remove their OWN flag** (409) — not paternalism, it is the only guard against
locking everybody out, since there is no other door back in.

#### A list is sorted from its own COLUMN HEADERS

Every table here pages server-side — fifty rows of four hundred — so a header
that reordered what is on screen would sort a twentieth of the table while
claiming to sort it, and the answer would change with the page you happened to
be on. `SortTh` therefore writes `sort`/`dir` into the URL and the request goes
again, and **only a column the API can genuinely order by is drawn as a
button**; everything else is a plain `TableCell` rather than a control that
lies. `TableSortLabel` carries the `aria-sort` and the arrow, which was the
hand-written half. The sort `<select>`s are gone — two controls for one
question is two places to look and one of them to keep in step.

**The contract names a COLUMN and a DIRECTION separately, and that is what made
the headers possible** (2026-09-23). The enums used to name both at once —
`newest`, `oldest`, `name`, `favourites` — which reads well in a dropdown and
cannot express half of what a header needs: there was no way to ask for Z–A or
for the least-saved dish, so a column could sort one way and then had nothing to
do on a second press. The keys are the console's own row FIELDS (`createdAt`,
`favouriteCount`, `useCount`, `recipeCount`, `aiCalls`), not database columns —
the header sits over a field, and a tag's usage count is not a column at all.
The old values are **rejected, not translated**: nothing links to them and a
silent alias is how a vocabulary stays doubled forever.

- **A first press takes the column's natural direction** — a name A–Z, a count
  biggest-first, a date newest-first — and pressing the sorted column reverses
  it. `first` on `SortTh` is that per-column decision.
- **Two sorts rank in JS over the WHOLE table and page afterwards**: tags by
  usage (the count is not a column, so the database cannot order by it) and
  users by AI calls. The users one was a page-scoped sort before it was a
  header, which was tolerable in a dropdown labelled "Heaviest usage" and is not
  when a column claims to have ordered the directory. Its window is read once
  for everybody and the same tally fills the page's own column — **and it is
  deliberately not filtered by `user_id` on that branch**, because every
  account's id in a PostgREST `in` list is exactly the shape that reaches
  **414 URI Too Long**.
- **`useListParams` owns the URL rules**, which were six copies of one
  `setParam` — including "any change but paging returns to page one", which is
  the rule that goes missing in the sixth copy and is invisible until a filtered
  list looks empty. `clearOnChange` is the step-art screen's extra rule (its
  open dish has to go when the list changes), declared once so the SORT obeys it
  too — which the page's own copy did not, sorting having been a select outside
  it.

#### A press is answered by a TOAST; a condition is still chrome

The banner under the page heading said what happened *there*: on the recipe
detail page a curator presses Save at the foot of a long form and the answer
lands eight hundred pixels above them, so the only visible sign of the press is
the page not appearing to do anything. `ToastHost` is mounted **outside the
router**, so a notice survives the navigation that is its own consequence —
deleting a recipe answers and then leaves for the list.

- **One at a time, newest wins.** A stack is what you build when several
  unrelated things can finish at once, and in a console driven by one person's
  presses they cannot; two visible toasts is instead how the second answer to a
  press hides behind the first.
- **What stays a banner is anything STANDING** — a list that could not be read
  (`ResourceState`), the rename warning beside the picture. Those are true for
  as long as they are on screen and would be wrong to time out.
- **A failure gets twice the dwell of a success** (7s against 3.5). A success is
  read in a glance and its consequence is on the page behind it; a failure names
  something that has to be understood before it can be acted on. Neither is a
  limit on reading it — the toast is dismissible and is `role="status"`.
- **The live region is drawn whether or not anything is in it.** A
  `role="status"` element inserted at the same moment as its text is not
  reliably announced.

#### The delete dialog behaves like one

`ConfirmDelete` gained Escape and a focus trap (2026-09-23). Without the trap,
Tab walks out of the dialog into the page behind it — which here is a table of
destructive buttons, under a backdrop that hides where the focus went. Two
things about it are measured rather than assumed:

- **The opener is captured during RENDER, not in the effect.** React applies the
  field's `autoFocus` during the commit and effects run after it, so by the time
  an effect could look, `document.activeElement` is the dialog's own input —
  and "restore the opener" restores focus to an element about to be unmounted.
  Focus then falls to `<body>` and the reader is at the top of the page, which
  is the exact failure the restore exists to prevent.
- **The restore is scheduled a tick late so StrictMode can cancel it.** React
  mounts, unmounts and remounts every effect in development, so the cleanup runs
  once while the dialog is still on screen — restoring focus there pulls it
  straight out of the field the dialog just focused. The second run clears the
  pending restore; a real unmount has no second run.
- **The focusable set is queried on each Tab rather than cached**, because the
  confirm button is disabled until the typed name matches and a disabled control
  is not focusable — so the set genuinely changes while the dialog is open.

#### Hiding: `hidden_at`, and why a function signature changed

Hiding is **gone for everyone** (owner's call, 2026-09-22), not "dropped from
discovery": a hidden dish leaves the feed, search, pairings, components and its
share link, AND stops resolving for readers who saved it. The console counts
those references and says so before the press rather than refusing it.

`recipe_is_visible(uuid)` could not express it — it is handed `created_by` and
nothing else — so it became `recipe_is_visible(uuid, timestamptz)` and **the
one-argument version was DROPPED**. That drop is the design rather than tidying:
an overload would leave every existing call site compiling, running and
silently not filtering. Postgres refuses to drop a function anything depends
on, so the migration fails unless all five policies and three function bodies
have been updated — which is the review the change needs.

- **RLS covers every ordinary read and every SECURITY INVOKER function.** What
  it does not cover is a DEFINER function, which sees past policies entirely.
  The set was taken from `pg_proc` rather than guessed: `find_recipes`,
  `find_dishes_using_components`, `pairing_candidates_for_recipe`,
  `record_ingredient_substitution` and `search_recipes`. Each body in
  `20260922000001` is the live definition from `pg_get_functiondef` with one
  predicate added and marked `THE EDIT` — re-dumped rather than re-derived,
  because a hand-rebuilt copy is how an earlier migration's fix gets silently
  reverted.
- **`search_recipes` excludes hidden dishes from DEDUP too**, which is the one
  worth pausing on. It runs as the service role with no user, so it asks "is
  this part of the shared corpus" — and a hidden dish is deliberately out of
  it. Hiding a bad render therefore lets the dish be written again rather than
  deduping every future attempt onto an invisible row, which is exactly why a
  curator reaches for the control.
- **Suggestions hide through their own column**, and the migration tightened
  their two child tables at the same time: `recipe_suggestion_ingredients` and
  `recipe_suggestion_tags` were both `using (true)`, so a hidden suggestion's
  contents stayed readable by id — the hole `20260815000005` closed for
  recipes, still open here because nothing had ever been hidden.
- **KNOWN AND ACCEPTED**, unchanged from `20260815000005`:
  `recipe_display_tags` and `recipe_dietary` are views without
  `security_invoker`, so a hidden dish's TAG NAMES are still reachable by
  anyone holding its id. No name, no picture, no ingredients, no method.

#### Regenerating a picture

`POST /rest/admin/recipes/:id/image` is the one route here that spends money —
two image generations a press, since the renderer rolls twice and keeps the
better-framed one. Three things bite:

- **`force` had to be added to the renderer.** `generateAndUploadRecipeImage`
  short-circuits on an existing storage object, which is exactly right on the
  generation path and exactly wrong here; forced, it also skips the legacy-PNG
  re-encode branch, which would answer a regeneration with the same old picture
  in a new container. It never joins an in-flight render either — joining would
  hand the curator the picture they are replacing.
- **It is AWAITED, unlike every other caller.** Elsewhere the render is
  deliberately unawaited because the URL is predicted from the name. Here the
  request IS the render.
- **The URL does not change and nothing is written to `recipes.image`.** The
  storage path is derived from the dish's name. A cache-busting query parameter
  was considered and rejected: `uploadVariants` files the thumbhash with
  `.eq("image", <canonical url>)`, so a versioned URL in that column would
  silently stop matching and every future render would fail to attach a hash.
  **The console cache-busts its own `<img>` instead.** On hosted Supabase the
  objects are served `no-cache` whatever the upload asks for, so devices
  revalidate; the LOCAL stack honours the year-long max-age, which is why art
  replaced there stays stale until the client's dev menu drops its image cache.

#### Things that will bite

- **`admin_user_directory` exists because `auth.users` is not in the exposed
  schema**, and its guard is `auth.role()`, NOT `current_user`. Inside a
  SECURITY DEFINER body `current_user` is the function's owner whoever called
  it, so the service-role exemption was a constant that never matched and the
  API was refused its own route. The check is in the BODY rather than on the
  grant, so a later `grant execute … to authenticated` cannot quietly turn it
  into an email-address oracle.
- **`libs/admin-contract` is a lib of its own and not part of
  `@fridgeezy/schemas`.** That package is packed into the React Native client,
  so every schema in it is installed on a phone; nothing here is of any use to
  the app.
- **The admin router parses JSON; the rest of the app deliberately does not.**
  `express-app.ts` omits `express.json()` because the AI handlers read the raw
  stream themselves. That reasoning is about those handlers, so the parser is
  applied to this router only. CORS gained `PATCH` and `PUT` for the same
  change — React Native's fetch does not preflight, so an unlisted method is
  invisible from the app and fails only in a browser.
- **The console routes on the HASH.** Real paths would need CloudFront to
  rewrite every unknown path to `index.html`, which is a deploy and an
  infrastructure change that have to stay in step forever. The hash costs an
  ugly URL on a tool nobody links to.
- **Steps are replaced WHOLESALE (`PUT …/steps`), never patched row by row.**
  `step_number` is a position, so per-row editing makes the caller responsible
  for renumbering after every insert and delete. There is no transaction — a
  failure between the delete and the insert leaves the recipe stepless, and the
  route says so rather than reporting success.
- **Ingredient rows and tags are read-only on the recipe page.** A recipe
  ingredient is a join to the ingredient catalogue plus a quantity and a unit,
  which is what the generator resolves with a model; getting it wrong writes a
  recipe that filters and shops incorrectly.
- **Deleting a dish with reader versions is refused (409).**
  `recipe_variants.base_recipe_id` cascades, so deleting a base would destroy
  every reader's personal copy as a side effect of catalogue tidying. Hide it
  instead — a variant is its own row with its own visibility.
- **The storage object is never deleted with a recipe.** Art is keyed by NAME,
  so another row of the same name is pointing at the same object.

#### Deploying it

```bash
npx nx run @fridgeezy/database:env-remote   # SUPABASE_URL/ANON_KEY from SSM
terraform -chdir=infra apply -var-file=environments/dev.tfvars
./infra/deploy-admin.sh
```

Vite inlines `import.meta.env.VITE_*` at build time, so a deployed console
cannot be repointed without rebuilding — which is why `deploy-admin.sh` reads
all three values at deploy time from the places this repo already treats as
authoritative (`apps/api/.env.production` for Supabase, `terraform output
function_url` for the backend) and refuses outright if the Supabase URL points
at a local stack. Locally, `apps/admin/.env.local` holds the same three and
`npx nx run @fridgeezy/admin:serve` runs it on :4300.

**`index.html` is `no-store` and the hashed assets are a year.** That second
value is not symmetric with the first: `index.html` is the one object whose
name stays the same while its contents change, so a cached copy keeps pointing
browsers at the previous bundle's filenames — which are still in the bucket, so
nothing errors and the deploy is simply invisible.

## The allowance (`require-quota.ts`, 2026-09-03)

Enforcing "no model call without a subscription" is correct and converts badly:
nobody who has not paid can experience a single one, so the paywall is a *claim*
rather than a demonstration. `requireQuota` turns the same gate into "here is
your recipe, four left", and moves the ask onto somebody who has already had
value out of us — which is the moment this file's own note on the teaser
boundary says is the most persuasive in the app.

**Three buckets, not one per route** — `recipes`, `photos`, `questions`. Eight
counters is a spreadsheet; these are three nouns a cook recognises, and the
client says them in those words. They run ACROSS the modules rather than along
them, which is why the gate is per ROUTE while the tier is per mount:
`/recipes/import` is a photo and `/recipes/:id/chat` is a question.

**`/suggestions/generate` is deliberately not metered.** The feed generates dish
ideas ambiently as the reader scrolls, so nobody experiences it as an action
they took — "you are out of ideas" would point at nothing on screen. The
catalogue already holds hundreds of stored suggestions free to read, which is
what makes the split work: the IDEAS are free, and what costs money is turning
one into a recipe.

Things that bite:

- **`metered` gives up the fail-closed default, so it is bought back at boot.**
  `assertMeteredMountsAreGated` (`rest/index.ts`) walks every route under a
  metered mount and **throws** if one carries neither `requireQuota` nor
  `requireEntitlement`. It throws rather than warning: a failed boot is loud and
  identical in dev and prod, where a warning on a Lambda cold start is a line
  nobody reads while an AI route serves itself for free. Verified by removing a
  gate and watching it refuse to build the router.
- **The arithmetic is ONE SQL function.** `ai_quota_status_for(uuid)` is what the
  middleware reads; `ai_quota_status()` is its caller-scoped twin, which the app
  reads for the rows in Settings. There is no second copy, deliberately — a
  client promising two more recipes while the server answers 402 is this
  feature's worst failure, and it is exactly what `entitlement_is_active` /
  `isEntitlementActive` live with because they have to.
- **The events are kept for 90 DAYS and then swept** (`20260918000002`).
  `ai_usage_events` is one row per charged call with no uniqueness and, until
  then, nothing that ever deleted one — the fastest-growing per-user table here
  and the only one that grows purely as a side effect of the product working: at
  the subscriber ceilings that is up to 450 rows a week, ~23,000 a year for one
  heavy subscriber. Only the current PERIOD is ever read (`created_at >=
  period_start`, one week), and the welcome allowance is decided by comparing
  that period start against the profile's `created_at` anchor rather than by
  counting events — so no prune can change what anybody is allowed. Ninety
  rather than seven because the rows are also the audit the table's own header
  asks for, and a disputed count arrives weeks after the charge.
  **It is a daily `pg_cron` job, never a trigger**: an event log was chosen over
  a counter partly to keep read-modify-write off the request path, and a
  delete-on-insert would put one back on the hottest gated path to collect rows
  whose age has nothing to do with that request. First job ever scheduled on
  `pg_cron` — `delete_orphan_generated_recipes` stays unscheduled because it
  deletes RECIPES and still cannot tell a draft from a catalogue entry, a hazard
  this one does not carry.
- **Charging happens on the way OUT, on a 2xx**, never on arrival: a quota that
  bills for failures feels like a swindle. The honest limit is that an SSE route
  writes its 200 before the first model call, so a generation that dies
  mid-stream still counts — the lesser evil, since the call was made and did cost
  us. What is not left to chance is the **reuse shortcuts**, which take a
  recipe's price for no model call at all: `promote`'s already-promoted branch
  and `resolve`'s catalogue hits and notability refusals call
  `waiveQuota(req)`.
- **Limits live in `ai_quota_limits`, a table**, so the numbers can be tuned
  without a deploy — they are the part most likely to be wrong, and the honest
  answer only comes from watching conversion. Free: 5 recipes then 2/week, 3
  photos then 1, 15 questions then 5. Subscribers get a silent fair-use ceiling
  (60/40/350 a week) that a real cook must never meet — **the client draws no
  ceiling for that tier**, because telling somebody on an unlimited plan that it
  is limited is worse than saying nothing.
- **The period is a WEEK on both tiers** (`period` on each limit row, 2026-09-04;
  it was a month until then). Two different arguments landed on the same window:
  - **Free** — a monthly cap spent on day three leaves the app dead for
    twenty-nine days, which is a churn, not a conversion. This migration's
    predecessor made that argument itself and answered it with a bigger *first*
    bucket, which only moves the dead month to month two. A week also matches the
    clock the product already runs on: `/plan` is seven days, the shop is weekly.
  - **Subscribers** — the row is a rate governor, not an allowance, and a monthly
    bucket governs nothing: 150/month permits all 150 inside an hour, which is
    the entire month's spend before a chargeback can be noticed. Weekly bounds
    the burst. Every comparable product caps on a window far shorter than its
    billing period for the same reason.
- **The ceiling is NOT the monthly figure over four, and free is NOT a fraction
  of the ceiling.** The ceiling is sized against a heavy real week (~20 recipes)
  with a wide margin, landing near monthly ÷ 2.5. Free is sized against what a
  week of cooking looks like. Tying the two by a ratio would move the free tier
  every time the anti-abuse threshold was retuned; that they land ~1:30 apart is
  a consequence, not a target.
- **The period is anchored on SIGNUP, not on a calendar boundary.** A calendar
  reset hands somebody who joins on the 28th three days of allowance, and a
  Monday reset stacks every user's allowance onto one morning — 4.3× more
  concentration on a weekly window than a monthly one had.
- **A subscriber refused on their ceiling must not meet a paywall.** `requireQuota`
  answers 402 on either tier and the two mean opposite things, so the body carries
  `tier`; the client reads it and raises a toast instead of the unlock sheet. Sold
  a subscription they already hold, the sheet closed itself the instant it opened
  (`useFeatureAccess` reports a subscriber `allowed`), so the whole answer was a
  modal that flashed over a stream that had failed silently.
- **It stands down only with `ALLOW_UNAUTHENTICATED`**, since with no user id
  there is nobody to charge. It used to stand down with `REQUIRE_ENTITLEMENT` as
  well and had to — metering while purchasing was not shipped would have walled
  every user at five recipes with no way to buy more. That flag is gone
  (2026-09-04) and `ai_usage_events` only started filling then; before it, the
  middleware returned on its first line and the table was empty for three weeks
  while every route looked correctly wired.
- **Revoke function grants BY NAME.** Supabase's base setup grants EXECUTE on new
  functions to `anon` and `authenticated` directly, so `revoke ... from public`
  does not touch it — the first cut of this migration left the shipped anon key
  able to read any user's quota by id.
- **And revoke FROM PUBLIC as well, because it happens both ways round**
  (`20260918000003`). The two signup triggers carried
  `{=X/postgres,…}` — the empty grantee is PUBLIC, and `anon` held EXECUTE
  through it rather than by a grant of its own, so `revoke ... from anon,
  authenticated` changed the ACL not at all and `has_function_privilege` still
  answered true. One incident each way is the argument for naming all three
  every time.

### Where the model time goes (measured in production, 2026-09-18)

Fourteen days of `[LLM]` lines out of `/aws/lambda/fridgeezy-dev-api`. Read this
before optimising a prompt for speed.

| label | calls | avg ms | out tok | in tok | ms/tok |
| --- | --- | --- | --- | --- | --- |
| `suggestions.promote` | 12 | 9,960 (p95 18,980) | 1,294 | 2,553 | 7.7 |
| `recipe.modify` | 1 | 8,623 | **1,738** | 3,394 | 5.0 |
| `suggestions.batch` | 3 | 5,824 | 379 | 5,656 | 15.4 |
| `suggestions.single` | 11 | 2,576 | 167 | 1,520 | 15.4 |
| `authenticity.verify` | 23 | 975 | 25 | 1,162 | 39 |
| `adjudicate.ingredient` | 30 | 952 | 11 | 604 | 87 |

**LATENCY IS NOT EXPLAINED BY OUTPUT SIZE, and that is the finding.** Per-call,
`suggestions.promote`'s two slowest runs (18,980 ms and 16,743 ms) emitted 1,343
and 1,318 tokens, while its two LARGEST outputs (1,992 and 1,865 tokens — half
as much again) finished in 8,781 ms and 8,814 ms. Per-token throughput ranges
4.4–14.1 ms, a 3.2x spread on one model and one prompt. That is supply-side
variance at OpenAI, so **trimming the prompt buys ~20% off the calls that are
already fast and nothing predictable off the slow ones.** Combined with the
settled model choice (gpt-4.1, evaluated 2026-09-12 — do not re-litigate) and
the serial round trips already removed from in front of the first token, there
is no prompt-side latency win left to take.

**What the zeros in `cachedInputTokens` are NOT.** Five labels show zero cached
input, which the field's own note calls the signature of a broken cache prefix.
Here it is traffic: those labels have one to three calls spread over two weeks
and OpenAI's cache expires in minutes, while `adjudicate.ingredient`'s 604-token
prompt is below the 1,024-token minimum and can never cache at all. The labels
with enough traffic (`promote`, `authenticity.verify`) show caching working.

**`firstTokenMs` exists because `latencyMs` cannot answer the question.** It is
wall clock to the last chunk — right for Lambda billing, which is what it was
built for — and every slow call here is STREAMED, so what a reader waits is time
to the first content chunk plus the stream rate. A 19-second call might be 2 s
of silence and 17 s of steady streaming (the client draws fields as they land)
or 15 s of silence and a burst; those have different fixes and the logs could not
tell them apart. First real call after the change: `latencyMs 3,223` against
`firstTokenMs 2,435` — **76% of it before anything appeared** — on a small
prompt, so not yet a claim about promote, which is what the next production week
will say.

**Every call site is labelled now.** `ingredients.classify-component` and
`ingredients.classify-diet` were unlabelled and were, between them, 41 of 124
calls — a third of the table reading `(none)`. They are background work behind
`trackBackgroundTask` (parallel, off the user's path), so they cost Lambda
duration rather than user time, but an unattributable third of the traffic is
not something to reason around. `label` is optional in `LlmUsage`, which is the
only reason it was possible to forget.

**One user action is many calls.** A feed batch request makes up to NINETEEN
model calls (one `suggestions.batch`, then per-dish `authenticity.verify` and
per-ingredient `adjudicate.ingredient`), 27 s of summed model time in one
request; a promote makes two. The per-dish calls are ~1 s each of mostly fixed
overhead — 39 and 87 ms per output token — so their cost is round trips, not
generation.

### What the performance advisor is actually saying

Audited the same day as the security one, and it splits the same way — one real
item, one popular fix that buys nothing here, and one category local data cannot
answer.

**`auth.uid()` in a policy is a FALSE POSITIVE in this schema, and nobody should
"fix" it.** Fourteen policies call it unwrapped, which is the advisor's
most-cited performance item (`auth_rls_initplan`), and the standard remedy is to
wrap it as `(select auth.uid())` so it is evaluated once instead of per row.
Measured with `EXPLAIN ANALYZE` under `set role authenticated`: the plan reads
**`hashed SubPlan 1`** with `loops=1`. Every one of these policies is shaped
`profile_id in (select id from profiles where user_id = auth.uid())`, and an
uncorrelated `IN (subquery)` is already hashed once per query. Rewriting all
fourteen would change nothing.

**What WAS real: `profile_recipe_interactions` had no index for the way it is
read** — see `20260918000004`. Three single-column indexes, and every read asks
for one profile, one type, newest first. Measured on 202,000 rows with the real
distribution (4,000 profiles × 50, plus one at 2,000):

| query | before | after |
| --- | --- | --- |
| favourites list (uncapped) | 666 rows via BitmapAnd, **16,666 index entries scanned** off the type index, 44 buffers, 0.297 ms | one bitmap scan, 31 buffers, 0.145 ms |
| viewed keyset page | 1,314 rows + top-N sort, 28 buffers, 0.178 ms | 18 rows, 5 buffers, **0.019 ms** |
| the prune trigger | **1,340 buffers**, 0.721 ms | 72 buffers, 0.200 ms |

The third row is the one that matters most and was not what the change was aimed
at: that trigger fires on EVERY recipe open, so it was the most frequently
executed statement in the schema and it was doing 1,340 buffer hits a time.

**Two indexes came off in the same migration.** `interaction_type` alone indexes
two distinct values and the planner never chose it — the favourites plan above
shows what it did when forced into a BitmapAnd, scanning 16,666 entries to
contribute nothing. `profile_id` alone is strictly dominated by a composite
leading with the same column. `recipe_id` STAYS: it covers the other direction,
which `merge_recipe` and the orphan sweep need.

**Unindexed foreign keys: twelve, and most are not what they look like.** Every
profile-scoped table has `profile_id` leading an index, which is the direction
that matters for the cascade behind account deletion. What is genuinely
uncovered are FKs pointing at `recipes`/`ingredients` — `profile_cooked_log`,
`profile_ingredient_substitutions`, `pantry_items.ingredient_id`,
`recipe_variants.base/source_recipe_id`, `recipe_family_defaults`,
`profile_prompts.recipe_id` — several of which sit SECOND in a composite, which
does not help: this is PostgreSQL 17 and B-tree skip scan is 18. They are
scanned when a recipe or ingredient is DELETED, i.e. the merge functions and
`delete_orphan_generated_recipes`. Low frequency today; the day that sweep is
scheduled it becomes a bulk cost, and that is the day to add them.

**Unused indexes and slow queries cannot be answered locally.**
`pg_stat_user_indexes` here reflects whatever was probed in the last hour, and
the catalogue is 71 recipes, so `find_recipes` seq-scans regardless of how it
behaves at scale. Both belong to the dashboard on the linked project.

### What the security advisor is actually saying

Audited 2026-09-18 against the database rather than the lint list, because the
categories it reports do not say whether anything is exposed. **Nothing was
open:** RLS is enabled with at least one policy on every table in `public`, no
policy grants `anon` anything profile-scoped, and no extension lives in
`public`. The six views it calls "SECURITY DEFINER" read catalogue tables that
are world-readable by design; the two that touch user data (`profile_pantry`,
`dish_components`) were already `security_invoker`.

What was real was four SECURITY DEFINER functions with a mutable `search_path` —
`find_recipes`, `has_user`, `handle_new_user`, `handle_new_profile` — pinned to
`public, pg_temp` by `20260918000003`, along with revoking the two trigger
functions' EXECUTE from public/anon/authenticated. Three things worth keeping:

- **It was defence in depth, not a hole.** The hijack needs a caller who can
  CREATE a shadowing object, and `anon`, `authenticated` and `service_role` all
  have CREATE on `public` revoked and cannot create a schema, role or database.
  The trigger functions cannot be called directly at all — Postgres answers
  `trigger functions can only be called as triggers`. The reason to do it anyway
  is that a standing wall of amber is how a real finding gets scrolled past.
- **`pg_temp` goes LAST.** Left off the path entirely, Postgres puts it first —
  which is the hijack the pin exists to prevent.
- **Pinning a path can break a function at RUNTIME, not at apply time.** Every
  cross-schema reference in those four is already qualified (`auth.users`,
  `public.profiles`), and none of them touches an extension function — the
  `vector` work lives in `search_recipes`, which is not a definer function and
  was left alone. Anything added to this list needs the same read, and then a
  real call: the migration was verified by signing a user up (both triggers
  wrote their rows), browsing `find_recipes` with the ANON key (12 rows), and
  probing `has_user` both ways.

So a mount declares what it costs and the loop applies both gates:

```ts
{ prefix: "/suggestions", router: SuggestionsRoutes },                  // paid
{ prefix: "/prompts",     router: PromptsRoutes, tier: "account" },     // free
```

**`tier` defaults to `subscriber`, so forgetting fails CLOSED.** That is the
whole reason it moved back. This is the third arrangement and it returns to the
first: pre-2026-08-12 the gate ran on every mount but `billing`, which made
"signed in" and "subscribed" the same thing; it then moved per-route because the
split genuinely ran *through* the recipes module (`generate` free, `compose`
paid), which a mount cannot express. Once every AI feature became paid, no
module was split but `/speech`, and a mount could express it again — recovering
the property auth has always had, that an omission cannot give anything away.

**`/account/delete` is free for the same reason `/prompts` is, one step
larger** (2026-09-18). `POST /rest/account/delete` erases the caller's account:
one `auth.admin.deleteUser` and nothing else, because every profile-scoped table
is `on delete cascade` from `profiles`, which is cascade from `auth.users` —
seventeen tables, checked against the database rather than assumed. A gate in
front of the exit is the one that can never be defensible, and App Store
5.1.1(v) requires the door to exist at all. Three things about it:

- **The id comes from the token, never from the body.** `supabaseAdmin` bypasses
  RLS, so `req.supabaseUserId` is the whole of the authorisation; a route taking
  a `userId` would be an account-deletion oracle for anyone holding any valid
  token.
- **Two cascades look alarming and are correct.** `recipes.created_by` and
  `menus.owner_profile_id` both cascade, and both are NULL for shared content by
  design — a non-null `created_by` is an IMPORTED recipe (private to the
  importer) and an owned menu is a private composition. The catalogue a
  departing account generated stays, and so do the menus other people saved.
  Verified end to end against the local stack: profile, interactions, prompts,
  shopping lists and usage events all gone, the shared recipe still there.
- **POST rather than DELETE**, and that is a client-shaped decision: the app's
  one helper for this API (`postBackendJson`) is POST-only and carries the token
  refresh, the 401/402 mapping and the connectivity report. `/billing/reconcile`
  is the same shape.

**`/speech` is the one exception, and the only per-route gate left in the app.**
Synthesis is free because `getOrSynthesizeSpeech` is content-addressed — the
text hashes to a storage path, so a step spoken once is a storage read for every
listener afterwards, forever — while `/speech/command` is an uncached classifier
call and carries `requireEntitlement` directly. If that module ever loses its
free half, delete the per-route gate and give the mount the default rather than
leaving a lone opt-in behind.

The startup banner marks `← premium` from **two** sources that must agree: the
mount's `tier`, and the `requireEntitlement.isEntitlementGate` marker for a
route inside an `account` mount. Note the asymmetry that leaves — the mount half
is a *declaration* the banner echoes, not a derivation from the router stack
(Express 5 does not expose a mounted router's path, which is why `MOUNTS` exists
at all), exactly as `isPublic` already works. The per-route half is still a true
derivation. **After changing any tier, read the banner**: 14 premium routes,
3 open, and `/speech/synthesize` plus the four `/prompts` lines unmarked.

The marker is a property rather than the function's name because esbuild may
rename a local binding in the Lambda bundle, which would leave the banner
reporting zero while the gate was in fact enforcing.

**What is deliberately NOT gated, and why it is not an oversight:** everything
the user owns — saves, favourites, collections, shopping lists, saved menus,
recipe variants, cooking mode, and setting dietary preferences, allergies,
dislikes and skill level. None of it reaches this API; the client holds it in
Supabase directly. Note the consequence for personalisation: the dietary
filters, the blacklist and `difficulty_preference_rank` are all **parameters to
`find_recipes`**, which the client calls with the shipped anon key — so nothing
computed in that function can be paywalled without moving it server-side first.
The paid half of personalisation is the half that runs a model
(`POST /recipes/:id/personalise`, dark behind `TASTE_PROFILE_ENABLED`).

`entitlementExempt` is gone — with the tier declared per mount, nothing needs
exempting.

**The gate is unconditional — `REQUIRE_ENTITLEMENT` is gone (2026-09-04).** It
was a rollout switch, defaulting to OFF in dev and prod alike, for a gate that
could not be enforced while there was nothing to buy. What retired it is that
there now is: real App Store products against the store key, and RevenueCat's
**Test Store** (`EXPO_PUBLIC_REVENUECAT_TEST_KEY`) for local work, whose
purchases go through RevenueCat's own backend, grant the entitlement and fire a
real webhook. The app moved the same way — `paywall-override` defaults to
enforcing whenever a Test Store key is configured. **Do not reintroduce a flag**:
a standing one is how enforcement ends up off in production with nothing to say
so, which is exactly what it did here.

It still stands down when `ALLOW_UNAUTHENTICATED=true`, which is now the only way
off it: with no auth there is no user id to look an entitlement up for, and that
combination used to answer 500 "misconfigured" on every premium route.

**A local stack never receives a webhook.** RevenueCat delivers to the one
configured Function URL, so a Test Store purchase made against `npm run api:dev`
grants the entitlement on the device and writes the row into the REMOTE Supabase
— the local API still answers 402. `TARGET=local ./infra/send-webhook-event.sh
INITIAL_PURCHASE` is the supported way to hold one locally (and `CLEAR` to drop
it again); it reads the secret from `apps/api/.env`, the database from
`apps/api/.env.dev`, and refuses any `API_URL` that is not loopback.

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

  **Generate at the aspect the asset is displayed at wherever you can.** It is
  the only framing control that actually works — `generate-dish-tiles` renders
  9:16 for a 9:16 slot. The recipe hero is the exception, and it pays for it
  (see below).

  The default image model is `gemini-3.1-flash-image` (Nano Banana 2), set
  2026-09-13 on the owner's call and **not yet measured against this art
  direction**. `GENAI_IMAGE_MODEL` overrides it without a deploy, which is how a
  comparison gets run. Cost is ~$0.067/1K image against Pro's ~$0.13 and Flash
  2.5's ~$0.039, bounded per *dish* rather than per view because
  `generateAndUploadRecipeImage` short-circuits on an existing object at the
  deterministic storage path. Always a GA id, never a `-preview` one: those are
  what get retired underneath you.

  **The 2026-08-04 blind A/B that used to justify this line no longer governs
  it.** It ranked Pro over Flash 2.5 — but the rendering-medium line was
  rewritten on 2026-08-19 specifically to fix Flash rendering this style flat
  and hard-outlined, and it worked, so that sweep ranked models under a prompt
  that no longer ships. Anything claiming a model is best here needs a fresh
  comparison behind it.

  **Ground temperature is the axis to watch on a model swap, ahead of
  saturation.** Comparing Pro against Flash 2.5 on 2026-09-13, mean subject
  saturation was effectively identical (0.369 vs 0.352) while the ground
  diverged: Flash paints ~#F7F2E0, Pro ~#FBF7EE, against a spec of #FDFBF9. Pro
  is the more faithful and Flash drifts warm — but the app's page ground
  `#FCFAF6` was derived from Flash's warmth, so Pro's colder field made the same
  food read as more saturated and less appetising. If a model's output reads
  cold, warm `ground`; do not touch the palette, which pins hue on purpose.

  `gemini-2.5-flash-image` is the cheap fallback and the variant the current
  prompt is actually tuned for — but Google now flags it legacy, so it is on a
  clock. `gemini-3.1-flash-lite-image` (~$0.034) is the untested cheap option.

  **Google retires model ids underneath you, and it presents as a 404.**
  `gemini-2.5-flash` began answering *"no longer available to new users"* in
  mid-August 2026, which reached the app as a dead microphone button rather than
  as anything naming a model. `interpretCommand` therefore runs on the
  `gemini-flash-latest` **alias**: for a classifier held to a tight prompt and a
  strict schema, model drift is cheap and an outage is not. TTS and images stay
  pinned, because there the exact model *is* part of the output. When a call
  that worked last week 404s, check the model id before anything else — and note
  that `GET /v1beta/models` will happily list a model the key can no longer use.

  **Recipe images are stored exactly as the model returns them, and a padding
  step that widened them to a square was REMOVED on 2026-09-11.** It read the
  PNG chunks by hand, replicated the edge columns outward to square the 3:4
  render, and carried a corner-shadow correction on top of that — and the
  artefacts it introduced were more visible than the crop it was compensating
  for. Do not rebuild it without new evidence.

  The problem it was aimed at is real and is now simply accepted: the client
  shows one asset in boxes from 0.62 to 1.36 aspect, all cropping to fill, so a
  3:4 render loses 45% of its height in the widest of them and can cut into the
  plate. Both of the obvious alternatives were measured and rejected too —
  asking the model for a smaller plate does not work (plate size swings 51–87%
  of frame height on an identical prompt), and `contentFit="contain"` in the
  client is wrong because these surfaces are full-bleed. **If this is worth
  fixing again, fix it at the aspect the asset is GENERATED at, or at the box it
  is displayed in — not by rewriting the pixels afterwards.**

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
- **`ingredient_canonical_id` singularises only the LAST word**, so a compound
  whose EARLIER word carries the plural makes a second identity: `Brussels
  Sprout` -> `brussels_sprout` and `Brussel Sprout` -> `brussel_sprout` are two
  rows for one vegetable, and nothing in the write path can tell them apart. Not
  cosmetic — `find_recipes` filters by ingredient ID, so a split catalogue
  answers an ingredient question with a fraction of what it holds. Measured
  2026-08-24: 17 brussels-sprouts dishes stored, the search returned 3; after
  the merge, 8 of 8 asked for.

  `nx run @fridgeezy/database:merge-spelling-variants` collapses them —
  deterministic, no embeddings, no LLM, dry run unless
  `MERGE_VARIANTS_APPLY=true`. Run it BEFORE `dedupe-ingredients`: this is the
  cheap half and the half that recurs, while that one hunts synonymy
  ("scallion"/"green onion") which only a model can judge. The merge leaves the
  losing name behind as an ALIAS, and that is what stops the row coming back —
  the next "brussel sprouts" resolves through `findByAliasCanonicalIds` instead
  of falling through to a create.
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
- **A COMPONENT is never the dish built on it, whatever the signature says.**
  `componentsDisagree` (`component-identity.ts`) is a hard gate in BOTH dedup
  paths — `findRecipeForDish` and `persistOrReuseSuggestion`'s layer 3 — checked
  BEFORE the score, so it overrules auto-merge above `SIGNATURE_HIGH_THRESHOLD`
  too. A ragù and a lasagne share nearly every ingredient, so their signatures
  score higher against each other than most genuine duplicates do; this is the
  one case similarity is structurally incapable of judging, and this repo already
  said so twice ("similarity alone always scores a bechamel query highest against
  Lasagne", and the `from` parameter on `/recipes/new`).

  Measured 2026-08-24: "Give me a Ragu recipe" generated a correct Ragù,
  `findRecipeForDish` folded it into the catalogue's **Lasagna**, and chat
  answered a request for a sauce with a baked pasta dish. The tags said so the
  whole time — the ragù carried `sauce`, the lasagne did not — and nothing read
  them. The gate can only ever keep two rows APART; it never merges anything the
  signature considered distinct.

  `COMPONENT_TAGS` moved to `component-identity.ts` so `suggestions/` can read it
  without importing `search-recipe-suggestions` (that direction is already taken;
  closing the loop would make them cyclic). It is re-exported from the old path
  because the chat tool's `component` enum imports it from there.
- **A NAMED DISH IS NOT AN INGREDIENT, and passing one as an ingredient is what
  answered "give me a ragu recipe" with a pasta dish.** The generation call used
  to be `streamSingleSuggestion({ ingredients: [dish ?? query] })`, which renders
  as `Ingredients: Ragu` — and a ragù genuinely IS an ingredient of other dishes,
  so the generator read it as "a dish featuring ragù" and returned Tagliatelle al
  Ragù. It was doing exactly what it was asked. The system prompt's "the
  Ingredients line may ALSO be a dish name" is a GUESS, and it resolves the wrong
  way for every dish that is also a component of something else.

  A named dish now goes in on its own `Dish:` line
  (`StreamSingleSuggestionOptions.dish`, backend-local so it needs no tarball
  rebuild) with a rule that says to return that dish itself and never the plate
  built on it. `ingredients` is left EMPTY when a dish is pinned. Measured
  2026-08-24, 5 of 5: Ragu -> Bolognese Sauce, and Bechamel, Pesto, Lasagna and
  Thai Green Curry all resolve to themselves.
- **The generation path's `existing_recipe` outcome applies `isExcluded` and
  `isWantedComponent` — but deliberately NOT `isRequestedDish`.** Stages 1b and
  1c do apply it, because they match by similarity or by ingredient and a name
  check is what stops a lookalike impersonating the dish that was asked for. This
  row was chosen by DEDUP, whose entire job is to decide that two DIFFERENT names
  are one dish — Som Tam and Green Papaya Salad, "Bechamel" and "Béchamel Sauce".
  Requiring the name to match the user's phrasing refuses dedup's CORRECT
  answers: measured, a request for "Bechamel" generated "Béchamel Sauce",
  resolved onto the catalogue recipe of that exact name, and was thrown away for
  not being spelled the way the user typed it. What protects the
  Ragu-returning-Lasagna case is `componentsDisagree`, at the source, where the
  tags can actually settle it.
- **An INGREDIENT request needs its own relevance gate, and had none.**
  `isRequestedDish` is deliberately open when no `dish` was named — which is
  exactly what an ingredient question looks like — so every recipe clearing the
  0.5 similarity threshold was accepted for "give me a recipe containing brussels
  sprouts", none of which need contain one. `containsRequestedIngredient` is its
  counterpart: that one stops a similarity hit impersonating a dish the user
  NAMED, this one stops it answering an ingredient question with a dish that does
  not contain the ingredient. The ids are resolved ONCE and shared with
  `findCatalogueRecipes`, which is why that function now takes `ingredientIds`
  rather than names.
- **The two generators must state the notability bar the SAME way, and for a
  year they did not.** `generate-suggestions-stream` (the feed) carried "BEING
  WELL KNOWN IS PARAMOUNT" plus a ban on descriptive names; `stream-single-
  suggestion` — the one CHAT and the search screen use — carried only
  "AUTHENTICITY IS PARAMOUNT". Both are judged by the same gate, so the weaker
  prompt failed it constantly and silently. Measured 2026-08-24: five
  consecutive chat turns for "brussel sprouts recipe" produced "Roasted Brussels
  Sprouts with Hazelnut Dukkah", "Brussels Sprouts Tortellini", "Shaved Brussels
  Sprout and Hazelnut Salad", "Caramelized Brussel Sprouts with Hazelnut Dukkah"
  and "Brussels Sprouts Bourguignon", and the gate correctly dropped all five as
  `obscure`. The user's chat answered four retries with an error toast.

  **The floor was not the problem.** Put through the same classifier by hand,
  named brussels-sprouts dishes clear it comfortably — Choux de Bruxelles à la
  Flamande and Rosenkohl mit Speck both `well_known` at 0.9. Loosening `ATTESTED`
  for the direct-request path was the tempting fix and would have been the wrong
  one; the generator simply never reached for a named dish. Both prompts now
  share `WELL_KNOWN_RULE` (`constraint-rules.ts`), which also names the specific
  failure shape: handed a bare INGREDIENT — a vegetable most of all — the model
  composes a plate (`<method> <ingredient> with <garnish>`) instead of recalling
  the dish some tradition already named around it.
- **The single-suggestion path retries a notability drop; it used to get one
  roll.** The batch generator has had `MAX_PASSES`, a ledger and a saturation
  test since it was written, and the single path had none of it — so one bad roll
  ended a paid chat turn. `MAX_GENERATION_ATTEMPTS` is 2, the second attempt is
  handed the first one's name as a rejection (its own wording, NOT
  `buildExistingDishesBlock` — these dishes are the opposite of "already in the
  catalog"), and **only `unauthentic` retries**: `not_food` is a property of the
  request, and `duplicate` / `persist_failed` / `invalid` are not questions a
  second generation answers. Same distinction the batch's `saturated` test makes.

  It earns its keep because the gate is noisy at this margin: "Roasted Brussels
  Sprouts with Balsamic" clears at 0.9 while "Roasted Brussels Sprouts with
  Romesco Sauce" is dropped as `obscure`.
- **A drop that is a STATEMENT about the request now reaches the client.**
  `searchRecipeSuggestions` used to discard the whole `dropped` outcome, so a
  refusal and a crash left chat with the same empty array — which it reported as
  "Something went wrong" with a Regenerate button that re-ran the identical
  request. It now returns `SearchUnsatisfied` for `no_known_dish` and `not_food`
  only, and `process-chat` turns that into `buildUnsatisfiedLine` prose plus an
  `unsatisfied` frame. **A fault must keep returning nothing**: an empty result
  with no reason attached is still exactly that.
- **`onReviewed` is where a caller may first act on a dish's WORDS.** Chat starts
  writing its summary from it, so it fires past the notability gate rather than
  on the raw parsed object — otherwise a dropped dish left a finished paragraph
  on screen about a dish the reader never saw. It is still not a commitment
  (dedup can resolve the dish onto another row), but that mismatch is a real dish
  under a near-identical name.
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
- **A reused suggestion row is a card the feed must not draw twice.**
  Dedup resolving to an existing row is a success, and the single-suggestion
  endpoint returns it as-is. The batch feed must not: emitting it renders the
  same dish twice under two `tempId`s with one `id`. The `SlotLedger`
  (`slot-ledger.ts`) therefore refuses to count a row this response already
  showed, or that the client named in `request.exclude`. Keep that decision in
  the *caller* — reusing the row is right, drawing it twice is not.
- **Nothing is announced until a card is certain**, and that is the whole shape
  of this endpoint's frames. It sends `SuggestionSlotsSchema` — one anonymous
  count for the batch, re-sent as it changes — plus the cards themselves. There
  is no per-dish placeholder and no withdrawal.

  It had both until 2026-08-21, and they put the pipeline on screen: a
  placeholder went out the instant the model wrote a NAME, so four skeletons
  appeared as the lines were parsed, two vanished as `obscure` verdicts landed
  seconds later, and two more appeared when the top-up pass refilled the slots.
  A slot is now counted at `onAdmit` (`persist-or-reuse-suggestion.ts`) — past
  the gate, past every dedup layer, before the persist that takes seconds — so
  it is a promise the batch can keep.

  Two things about it are easy to undo. **`verified` is a latch**: it says the
  first pass has been judged in full, which is what the client's searching
  interstitial waits on before handing over to a list; a top-up raising the
  count afterwards does not make it untrustworthy, and un-latching would drop a
  batch that admitted nothing on its first pass back into the loading screen.
  And **while a top-up is running the count is an AIM, not a tally**
  (`ledger.aimFor`) — reporting the one card it holds would empty the list of
  skeletons and leave it sitting there for the seconds that pass takes. The
  top-up itself is still sized from `ledger.count`, which never counts the aim.
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

### View history: fifty dishes, and a trigger that keeps it there

`profile_recipe_interactions` holds one row per (profile, recipe, type), and the
client UPSERTS `viewed` on every recipe open — so that half grew with every
distinct dish an account had ever looked at, forever, and nothing removed a row.
`prune_viewed_recipe_interactions` (`20260918000001`) keeps the newest **50**
per profile: an `after insert … when (new.interaction_type = 'viewed')` trigger,
plus a one-off backfill for the accounts that already had thousands. Same shape
as `record_prompt`'s 200 and `prune_profile_chat_conversations`' 60, and the
same two reasons — a product statement about how far back a history is worth
scrolling, and data minimisation on the most personal thing here after the
prompts.

Three things to know, all of them in the migration header:

- **`viewed` only.** `favourite` is the reader's own kept data and un-hearting
  needs every row of the dish; `cooked` is a record. Neither is ever pruned.
- **A re-view cannot prune.** It is an UPSERT that UPDATES `created_at`, and the
  trigger is `after insert` — an update cannot raise the count.
- **`delete_orphan_generated_recipes` is the coupling.** It keeps a generated
  recipe alive while ANY interaction row points at it, so a pruned view stops
  protecting a dish nothing else references. Latent while that sweep stays
  unscheduled (`20260801000015`); the two become live on the same day.

### Prompt history: what the cook actually typed

`profile_prompts` (`20260822000004`) is the log of every free-text prompt, one
row per turn, capped at the newest 200 per profile by `record_prompt` itself.
Until it landed, all of it lived on ONE PHONE — the client's
`CHAT_HISTORY_STORE` (zustand + AsyncStorage, uncapped), a route query string,
and a background-job id — so nothing survived a reinstall or followed anyone to
a second device.

**The write is server-side, on the three routes that carry prose.** `POST /chat`,
`POST /recipes/:id/chat` and `POST /recipes/modify` each call `recordPrompt`
(`modules/prompts/services`) as the turn passes: fire-and-forget through
`trackBackgroundTask`, never throwing, never sitting between the user and their
first token — the identical contract `recordTasteSignal` has, for the identical
reason. Only the LAST user message is recorded, because the client re-sends the
whole transcript every turn and recording the array would rewrite the entire
conversation on each request.

`POST /rest/prompts` exists for prompts those three never see, and **posting a
turn one of them already carried writes the row twice.** Prefer the automatic
path; it is the one a client cannot forget, and forgetting is exactly what
happened to the recipe-scoped Ask sheet, whose prompts were never written
anywhere at all.

Three things worth knowing before touching it:

- **This and `profile_taste_signals` are complements written from the same call
  sites, and neither derives from the other.** `recordTasteSignal` stores the
  canonicalised LABEL (`vegetarian`) so repeats collapse onto one countable row;
  this stores the sentence AS TYPED ("can you make this one vegetarian for
  Ana?"), which is precisely what canonicalisation throws away. A history list
  can only be built from the second, and a threshold can only be crossed by the
  first.
- **`recipe_id` is NOT NULL exactly when the surface is recipe-scoped**, held by
  `profile_prompts_recipe_scope_check` rather than by four call sites
  remembering — the same construction `recipes`' "imported implies owned" check
  uses. It CASCADES: a swept recipe takes its prompts with it, so a history row
  always resolves to a dish that still exists. The alternative, `set null`,
  keeps the sentence and hands the UI an unopenable orphan.
- **`created_at` defaults to `clock_timestamp()`, not the `now()` every other
  table here uses**, and the deviation is load-bearing. `now()` is transaction
  time, so a batch writer hands the retention prune a block of ties to break on
  a random v4 uuid and it evicts an arbitrary subset instead of the oldest —
  measured at 250 rows in one transaction. Production writes one row per
  request, so it is not a live bug; it is a guarantee made by construction
  rather than by every future writer using its own transaction.

RLS mirrors `profile_taste_signals` exactly — **select and delete for the owner,
insert and update for nobody**, with `record_prompt` left SECURITY INVOKER so
the missing insert policy is what actually gates it. A client that can insert
here can forge the record of what a person asked. The client may therefore read
and delete its own history straight through PostgREST, which is cheaper than the
REST route and is the one to prefer for a plain list; the endpoints exist for
callers holding an API token and no Supabase session, and so read, write and
delete share one set of filters.

`ChatRequestSchema.conversationId` is optional and client-generated — the server
sees one turn and cannot tell a follow-up from a new thread that opens by
quoting an old one. A turn arriving without it is recorded as a loose prompt
rather than dropped, which is what keeps the field a backward-compatible
addition.

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

```bash
npx nx run @fridgeezy/database:check-menu-visibility
```

is its sibling for menus, and the reason it exists is that the danger runs the
other way there. `menus` became a SHARED table on 2026-08-21
(`20260821000001`) — every reader can read every menu, and the only thing
between a private one and the home feed is `menus.owner_profile_id`, which
`save_menu` has to compute right. So this composes a real menu around a real
imported recipe and tries to reach it as a guest AND as a second signed-in
user, then asserts the opposite half too: that a catalogue-only menu genuinely
does reach both. Run it after touching `save_menu`, either policy, or
`menu_is_visible`.

### The near-miss tier: one ingredient away, and why it is narrow

`find_near_miss_recipes` (`20260830000001`) returns catalogue recipes that fail
a dietary filter by **exactly one swappable ingredient**, with that ingredient
named. It is the rung between "the catalogue answered" and "pay a model to
write something new", and it feeds the search screen's *Close, with one change*
section. **It adapts nothing** — the card names the obstacle and opens the
recipe as it stands.

**The distance is not the judgement, and that is the whole problem.** Bak Kut
Teh is one ingredient from vegan and the ingredient is the pork ribs;
Apfelpfannkuchen is one from dairy-free and the ingredient is the butter. The
query cannot tell them apart. Measured over the live catalogue on 2026-08-30:
of the 161 (dish, diet) pairs at distance one, **96 are gutted dishes**, and
every one of those 96 has a blocker carrying `meat`, `fish`, `shellfish`,
`slaughter_derived`, `gluten`, `grain`, `legume` or `soy`.

So four structural gates, in SQL, and `check-near-miss` holds one fixture
against each:

1. the blocker's properties are a subset of `near_miss_swappable_properties`
   (dairy, egg, honey, sesame, nuts, refined sugar — things a dish is *cooked
   in*, not *built from*);
2. the blocker is not named in the dish's own title, folded, across both name
   columns (this is what kills Beurre Blanc → "French Butter Sauce",
   Cheeseburger → American Cheese, Yakgwa → "Honey Cookie");
3. the blocker is not `component_kind = 'dish'`;
4. the blocker is classified — an unclassified ingredient still counts toward
   the DISTANCE, but may never be the one we name, because naming it claims a
   swap nobody has checked.

That takes 161 pairs to 37, and **gluten-free and soy-free correctly produce
nothing at all**: soy sauce is classified `{gluten, soy, grain}` and is
therefore refused on the same rule that refuses pasta. Losing soy sauce →
tamari is the deliberate price — one Vegetarian Bak Kut Teh discredits every
correct row beside it. **Widening it is an INSERT into that table plus a
re-measurement**, which is why the list is a table and not an array literal.

One known survivor: **Margherita Pizza / Mozzarella**. Nothing structural says
mozzarella defines a Margherita. It is kept knowingly and is safe only because
nothing is adapted — it stops being safe the moment something offers to *write*
a dairy-free Margherita.

```bash
npx nx run @fridgeezy/database:check-near-miss
```

Unlike its two siblings above it is a SEMANTICS check, not a visibility one:
it builds ingredients and recipes covering each gate and asserts what the
function returns. Two things it pins that are easy to lose — a reader with no
dietary restriction gets **nothing** (the client hook disables the query
outright), and a dish that already satisfies the diet is never offered as one
change away from itself. Its fixture ingredients and recipes carry
**different** name prefixes on purpose: share one and gate 2 matches every
pair, every positive case is refused, and every expect-absent assertion passes
for the wrong reason. That happened.

### `p_pantry`: what can I cook from what I already have

`find_recipes` takes an optional `p_pantry uuid[]` that **ranks and never
filters** (`20260902000001`). It exists because every ingredient path here is a
conjunctive filter and an inventory inverts one: measured on the dev catalogue
with a 26-item fridge fed in the most generous order, `ingredients` returns 100
rows at one item, 29 at three, 2 at four and **0 from five onward, forever**.
Adding food to your fridge could only ever hurt.

**`ingredients` keeps its AND-all semantics** and the two live side by side.
Three callers rely on the conjunction as a *filter*, and the one that would
break silently is the client's: a SHORT PAGE is what tells the search screen the
catalogue is exhausted and it is time to generate (`getNextPageParam` in
`use-find-recipes`). Widen that filter in place and every page is full, so the
app quietly stops generating — a behaviour change that costs money in the
direction nobody would look. The other two are `use-suggestion-regeneration`,
which passes exactly ONE id and reads a hit as "another dish built on the same
thing", and chat's stage 1c.

**The ranking is fewest-missing, not most-used**, and the two are different
orders because dishes differ in size. Same fridge, top of each: fewest-missing
leads with Pan de Mallorca (have 3, buy 1); most-used leads with Palak Paneer
(have 5, **buy 6**) and Chili con Carne (have 4, **buy 9**). The second is a
shopping list, not dinner. The keys are

```
(pantry_have = 0), pantry_missing asc, pantry_have desc
```

and that first clause is not decoration — it closes both cases pure
missing-ascending gets wrong. A dish of nothing but staples scores (0, 0) and
would **top** the feed while using nothing you own; a two-ingredient dish you
have neither half of would outrank a twelve-ingredient dish you are one item
short of. Both are dishes the fridge did not reach, and one clause sinks both.
`pantry_have desc` is used rather than coverage because inside a fixed `missing`
tier they are the same order.

There is deliberately **no weighted score**. A weight would be a fitted constant
with no distribution to fit it against and no `calibrate` target to fit it with,
and it could not be printed on a card. This is a stated policy, like
`TIME_BAND_MAX_MINUTES`, and every key in it is an integer the reader can be
shown — which is what `pantry_missing_ingredients` is for. The client cannot
compute that list itself: it holds neither the staples list nor the alias
identity groups, so its own difference would disagree with the count beside it.

It sits below `difficulty_preference_rank` and above `favourite_count`. Skill is
a standing stated preference; a like count is inferred taste about everybody;
the fridge is what THIS reader said about TONIGHT. With no difficulty preference
set that rank is 0 for every row and the pantry becomes the primary key.

**Two things it would be easy to undo.** The pantry keys are in
`candidate_recipes`' truncation as well as in the final ORDER BY, and they have
to be — that LIMIT decides which dishes reach the page at all, so a pantry order
applied only at the end would reorder the alphabetically-first twelve and
nothing else. And the stats CTEs are guarded on `not pantry_empty`, which is
what makes a call with no pantry byte-identical to the previous ordering:
compute `missing` as "everything, since you have nothing" and the home feed, the
search screen and the dish picker — none of which pass a pantry — silently
reorder by ingredient count.

`pantry_staples` is a table of **canonical ids** for the same reasons
`near_miss_swappable_properties` is one, plus a forced one: ingredient uuids
differ between local and the dev project, so a uuid-keyed seed could not be
written in a migration at all. Staples are 17.7% of all ingredient rows and are
spread **0 to 4 per dish** against a mean dish size of 8.6 — a constant penalty
would be harmless, that variance is most of the signal. Category was measured
and rejected (this catalogue files Salt under `herbs_spices` beside saffron,
Water under `vegetables`, Bay Leaf under `mushrooms`); `use_count` was rejected
because it counts CATALOGUE coverage and its own migration says not to present
it. Bare `pepper` is off the list although `black_pepper` is on it — the word
alone will not separate the spice from the capsicum, and crediting somebody with
a bell pepper they do not have is the failure the list exists to avoid.

**An id is not a thing**, and this is the read-path half of alias resolution.
`resolveIngredientIds` and `matchIngredients` resolve a NAME; the picker hands
over an ID, so two ingredient ROWS that are the same thing stayed two ids.
`ingredient_identity_ids` closes an id over `ingredient_aliases` in both
directions and transitively (chains exist: "crushed red pepper" → Red Pepper
Flakes → Chili Flakes), and it is applied to `ingredients`, `blacklist` and
`p_pantry` alike — a blacklist that lets Minced Pork through because the reader
excluded Ground Pork is the same defect pointing at somebody's dinner. Dishes
reachable by picking the left-hand row, before → after: All Purpose Flour
1 → 76, Toasted Sesame Oil 2 → 27, Red Pepper Flakes 0 → 9, Risotto Rice 0 → 7.

Two traps in that. The AND count is computed **per requested id**, not over one
flattened closure — expanding two requests into four ids and leaving the count
alone would demand four distinct matches and make the filter *harder*. And
`parent_id` is NOT used: it is set on 5 of 1041 rows and means "is a kind of"
(Ghee→Butter, Quail Egg→Egg), so folding it in would answer a request for butter
with a ghee dish.

`find_near_miss_recipes` got the same closure, because the search screen calls
both with the same ids on one screen and a divergence would show a dish in one
and not the other. It gets no pantry key — that rail answers "one swap from
suiting your DIET", and ordering it by the fridge would put two questions in one
list.

```bash
npx nx run @fridgeezy/database:check-pantry-ranking
```

A semantics check like `check-near-miss`, and the group to read first is **1.
Inert without a pantry**: that is the assertion protecting every existing
surface. It also pins the degenerate cases (the all-staples dish, the untouched
dish), that staples count on neither side, that the named gap and the count
agree, and that the totals and facets do not move.

**What it costs.** Measured on a synthetic local catalogue at 9 ingredients per
dish: 1,000 recipes 16 → 36 ms, 5,000 46 → 86 ms, 20,000 155 → 258 ms. Linear
in the catalogue with a ~1.7 constant, and it does not change the complexity
class — this function was already linear because `family_picks`,
`total_recipes` and `facet_counts` each walk the whole matching set. The new
work is one hash-aggregated pass over `recipe_ingredients`, which is why a
30-item pantry costs the same as a 5-item one.

**Known and not fixed here:** most of the picker trapdoor is not an alias
problem. Only 475 of 1041 ingredients are used by anything, and rows like
"Grilled Tomatoes" carry no alias to Tomato — so an AND search on one still
empties. What `p_pantry` does for those is make a bad pick *harmless* rather
than fatal. Closing the rest is `merge-spelling-variants` and
`dedupe-ingredients`, not a query.

### The adaptation gate: the tap the near-miss card leads to

`POST /rest/recipes/:recipeId/adapt` answers the question the rail deliberately
does not — whether the dish SURVIVES the swap — and writes the result as a
variant of its own family. `runAdaptationGate` proposes a substitute
(`gpt-4.1-mini`, strict JSON) and then puts the dish WITH THE SWAP APPLIED
through `classifySuggestionAuthenticity`, whose `adaptation` status already
means "a real dish with a defining ingredient removed or swapped".

**It calls the raw classifier, never `verifySuggestionAuthenticity`.** That
wrapper fails OPEN — right on the generation path, where a fail-open costs one
questionable row that later layers still inspect, and exactly backwards here,
where it would hand somebody a dairy-free Beurre Blanc because a request timed
out. Every throw is a refusal.

**Fail-closed is structural, not a promise.** The only path that writes a row
and emits an `id` is the one that has already confirmed, in code and by
canonical id, that the blocker is absent from the GENERATED ingredient list.
Gate refusal, provider outage, generation failure, persist error and a rewrite
that quietly kept the ingredient all leave through `saved: false` with no id —
and an id is the only thing a client can open, so no client can render an
unadapted recipe as adapted. The prompt is told to replace the ingredient; that
is a request, and this is the check.

Refusals are FRAMES, not status codes, and only `gate_unavailable` is
`retryable`. The other four are settled verdicts about the dish and a retry
button over one spends money to reprint the same sentence — the distinction
`classifyError` draws (an exhausted quota is `service`/not-retryable, a rate
limit is `upstream`/retryable) reaching the reader.

**`not_attested` is separate from `defining_ingredient` on purpose.** "A beurre
blanc without butter is not a beurre blanc" is about the food; "we do not
recognise this dish" is about the CATALOGUE, and is the honest answer for
somebody's imported cookbook page, which the gate has never seen.

**The gate answers confidently on poor input rather than erroring**, which is
the trap the next person testing it will hit. Measured 2026-08-30: with
fixture-prefixed ingredient names and no tags it REFUSED Apfelpfannkuchen and
ALLOWED Beurre Blanc — wrong in both directions. With clean names but a thin
four-ingredient pancake (no egg, no milk) it flipped run to run. With a
faithful six-ingredient one it was `well_known` 3/3. Read `obscure` on a
catalogue dish as "this row does not look like its own name", not as model
noise. Full note on `AdaptationGateInput`.

## The shape of a chat turn

`processChat` used to be four model calls in a straight line — route,
acknowledge, generate, summarise — with the recipe card written after the last
of them. Rebuilt 2026-08-22 into three, with the card streaming out as it is
written rather than at the end. Read `process-chat.ts`'s own header before
changing it; the parts that bite:

- **`ROUTING_MODEL` is not `request.model`.** The first call fills in search
  arguments and produces nothing anyone reads, so it runs on a small model
  (`CHAT_ROUTING_MODEL`, default `gpt-4.1-mini`) while the summary keeps the
  client's. **Run `npx nx run @fridgeezy/api:eval-chat-routing` before changing
  that default.** Every argument it fills in exists because of a past failure —
  `dish` stops a green-curry request returning Thai Red Curry, `component` stops
  a Béchamel request returning Lasagne, `exclude` stops a follow-up handing back
  the card already on screen — and none of them fail loudly. They return a
  plausible, wrong recipe.
- **The acknowledgement call is gone.** `buildIntentLine` writes the opening
  sentence from the routed arguments. The prompt now tells the model *not* to
  write a preamble; that instruction is part of what the routing eval covers.
- **No card frame is written while the prose is still moving.** A bubble is text
  with a card under it, so a card emitted mid-summary gets pushed down the
  screen for as long as the summary keeps streaming. Partials are collected in
  `partialsByTempId` and the whole turn paints in step 7, after `await
  summaryTask`: the unready card (generator fields, no id), then the ready one.
  The unready flush is skipped when `toolResultsSettled` is already true, since
  a skeleton for one frame is flicker rather than a phase. A dish that is then
  refused gets a `withdrawn` frame — the same vocabulary the menu composer uses
  for a course it will not fill.
- **`summaryTask` must never reject.** The card is gated on it, so an
  unhandled failure there would hold the card back forever; it catches and logs
  instead. The prose is the least important half of the turn.
- **The summary starts from `onDishReady`, before persistence.** That callback
  fires when the generated dish validates and *before*
  `persistOrReuseSuggestion` — the review, the signature embedding, two lookups
  and a similarity search, all of which produce an *id* the summary does not
  need. Both run concurrently and the turn ends when both finish.
- **The tool-call/result pairing is exact.** A provider rejects an assistant
  turn whose `tool_calls` are not all answered, so `summaryTurn` presents one
  call with one synthesised result on the early path, and only the *answered*
  calls on the other. Do not simplify it to "take the first result".
- **The `while (continueLoop)` loop is gone**, and was already dead: every
  branch set `continueLoop = false`, so it never ran twice. Multi-round tool use
  would have to be built deliberately, not assumed.

### The one retry round (step 5b)

A turn that invoked the tool and produced no card is a DEAD turn — the client's
test is `sawSuggestionTool && noSuggestions`, so it discards the reply, shows
"Something went wrong" and offers a Regenerate that re-runs the identical
request. `SearchUnsatisfied` broke that loop for the two cases the search can
explain; **this is the case it cannot** — the search simply came back with
nothing and has no reason to give.

So the turn routes ONCE more, with the failed round in context (`RETRY_PROMPT`),
and the model either searches again with different arguments or answers in
prose. The user was going to spend this generation anyway by pressing
Regenerate; spending it here buys the model the one thing that button cannot
give it, which is the knowledge that the first arguments did not work.

- **`MAX_SEARCH_ROUNDS` is 2 and nothing loops.** This is the deliberate
  multi-round tool use the note above says would have to be built on purpose —
  and it is bounded rather than agentic, because the turn's whole shape depends
  on knowing its step count up front: the opening line is templated before the
  search starts, the summary runs concurrently with persistence, and the card is
  painted after the prose stops moving. A variable number of rounds costs all
  three and meters a `questions` unit the user thinks is one question.
- **A stated `unsatisfied` is never retried.** "No established dish under any
  name" and "that is a drink" are ANSWERS. Retrying one spends a second
  generation arguing with a verdict the search already reached, and puts
  "Something went wrong" back in front of a reader who had just been told the
  truth.
- **Only the branch where the TOOL RESULT won the `early` race gets here.** A
  turn whose dish was written and then dropped has already resolved
  `earlyDishReady` and started its summary — and those drops are the ones that
  state a reason anyway. It is also what makes this free for every turn that
  found something: on that branch `parseTask` has already settled, so the
  emptiness check costs a microtask.
- **The retry is offered ONE tool, not both.** It may search again; it may not
  turn a dish turn into a menu turn. `isMenuTurn` was read once and the summary
  prompt and step 7's frames have already branched on it.
- **No new frame, and that is what makes it invisible to the client.** The
  second round writes the same `tool_calls` / `content` / `intent` sequence the
  first did, and the reducer REPLACES on all three — so a second `intent`
  supersedes the first and the card's regenerate control follows the dish the
  turn actually went looking for. `npm run check:chat-frames` in the client
  drives both branches.
- **The prose branch carries `unsatisfied: no_known_dish`, and must.** Without
  it the client cannot tell a model that chose to answer in words from a stream
  that died — the shape on the wire is identical — and throws the reply away.
  `attempted` is empty because nothing was written to be refused, and step 7
  suppresses `buildUnsatisfiedLine` on this path so the reader gets one sentence
  rather than two saying the same thing in different voices.
- **A retry that fails or returns nothing claims NOTHING.** It logs and leaves
  the turn exactly as round 1 ended it. Marking an empty reply as answered would
  commit a turn whose only text is "let me look that up"; no worse than before
  this existed is the floor every branch here has to clear.
- **A route that produced nothing is evicted from the routing cache.** One bad
  reading of a popular dish name would otherwise be served for the rest of the
  TTL and pay for a retry every time. Round 2's route is deliberately not cached
  in its place — it was reached with the failure in context, so it is an answer
  to a different question than the key names.

### Two tools, and the router picks

`PLAN_MENU` answers a request for a MEAL — a menu, a dinner party, a feast —
with one menu card, where `GET_RECIPE_SUGGESTIONS` answers a request for a dish
with a recipe card. A menu turn emits a `menu` frame and no `suggestion` at all.

- **It generates nothing.** It resolves the main through the same search (one
  call, usually a catalogue hit) and names the courses. Composing costs a paid
  stream per course and happens later, on the menu screen, behind a second tap.
- **`main` is never one of the requested courses** — the main is what the menu
  is built around. `MENU_COURSE_SLOTS` is the four-slot vocabulary minus the
  seed, and the handler additionally subtracts every slot the resolved main
  already fills, the same way the client's picker filters its rows and
  `splitCourses` subtracts them server-side.
- **`courses` is optional, and unset means ASK.** The prompt tells the model to
  leave it out rather than guess: "a french menu with a side and dessert" fills
  it in, "a french menu" does not, and the client then asks in the thread. A
  plausible default looks helpful and removes the only moment at which the user
  is asked, which is why `eval-chat-routing` asserts BOTH directions.
- **The frame carries `availableCourses` as well as `courses`** — the closed
  vocabulary minus whatever the main already fills. That is what the inquiry
  offers when `courses` is empty.
- **The summary has two prompts.** `MENU_SUMMARY_PROMPT` states what the menu
  is; `MENU_INQUIRY_PROMPT` ends the turn on the question instead, and is told
  not to recommend — the card underneath is how the user answers.
- **`resultMenu` is a holder object, not a `let`.** It is written inside a
  `.then` and read after it, and TypeScript keeps the narrowing from a `null`
  initialiser across that boundary — every read of a plain variable would be
  typed `never`.
- **`main` carries either a `recipeId` or a `suggestionId`, never both.** The
  compose flow is keyed on a real recipe, but a suggestion is still the dish the
  user asked for — the client generates it on the way (`menu-compose`) rather
  than sending them off to search for a dish it just named. Only `main: null`
  falls back to the menu search screen seeded with `query`.
- **The summary uses `MENU_SUMMARY_PROMPT`** and a menu turn never takes the
  early-dish path — its summary is about the meal, and an early dish would have
  the model write about one course as though it were the answer.
- **The routing eval covers the boundary in both directions.** A dish that is a
  whole meal ("a one-pot dinner") and an accompaniment ("what should I serve
  with roast chicken?") both look like menus and are not.

### Frames

`intent`, `status`, `withdrawn` and `metrics` are new. **The client drops a
frame whose name is not in `create-sse-client`'s `eventTypes` allowlist,
silently** — that is how `proposal` was lost for a fortnight. Adding a frame
here means adding the name there in the same change, and running the client's
`npm run check:chat-frames`, which drives its reducer with this exact sequence.

### Search

`searchRecipeSuggestions` runs stage 1a (exact name) alone and then **1b, 1c and
2 concurrently**. The early returns between them saved database time on the path
that already had an answer while costing the sum of all three on a miss — which
is the path that then spends ten seconds generating. 1a stays serial on purpose:
one indexed lookup, decisive at `maxResults: 1`, and folding it in would make
every named-dish request pay for an embedding it currently skips.

`speculativeEmbedding` is started against the raw user message before routing
returns, and stage 1b reuses it **only when the routed query canonicalises to
the same string**. That is narrow deliberately: the routing prompt resolves
pronouns, so "what sauce goes with it?" becomes an entirely different query, and
reusing the vector there would search for the wrong thing on follow-ups only.
`search.embedding_reused` against `search.embedding_computed` is the measurement
that would justify widening it.

### Timings

`TurnTimer` writes one JSON line per turn as `type: "turn_timing"`, and the same
summary rides back as a `metrics` frame. It records **spans, not checkpoints** —
`at` plus `ms` — because the interesting property of this pipeline is what
overlaps, and a list of elapsed-since-start marks cannot express that.

    filter type = "turn_timing" | stats pct(spans.generate.ms, 95) by labels.outcome

Every latency decision before this was made off a reading of the code.

## Cold starts

Measured on `/rest/health`, the cheapest route: **1.45s cold, 0.08s warm**. A
cold chat turn pays more — the paginated SSM fetch in `load-secrets`, then the
dynamic import of the whole module graph, before it starts waiting on a model.

`infra/warmer.tf` keeps one execution environment alive with a scheduled
EventBridge ping carrying a **synthetic Function URL event** (`lambda.ts` can
only proxy that shape; a bare `{}` throws and would log an error every five
minutes). The app also pings `/rest/health` on chat-screen focus, which is what
covers the first message of a session.

Neither helps concurrent callers — each simultaneous request gets its own cold
environment. `lambda_provisioned_concurrency` is the lever for that, off by
default because it bills by the GB-second whether or not anyone calls. Turn it
on when the timing logs show cold starts surviving the warmer.

## Menus are shared; saving one is a reference

A menu is a global row keyed on `(main_recipe_id, dish_signature)` — two people
who composed the same dishes around the same main hold ONE row — and
`saved_menus` is the per-profile reference into it, the same shape
`recipe_variants` has to `recipes`. Four things worth knowing before touching
any of it:

- **Composing records the combination; favouriting is a separate act**
  (`20260822000002`). `record_menu` find-or-creates the menu, `save_menu` is
  `record_menu` plus the `saved_menus` reference — one find-or-create, not two
  copies of it. So a pairing somebody tried and walked away from is still in the
  corpus, and favouriting later lands on the row already recorded rather than
  minting a second.

  **The client is what calls `record_menu`, and that is forced rather than
  chosen:** a re-roll is a single-slot compose request, so the server sees one
  course plus the main and would record a dinner missing everything the user did
  not re-roll. Only the compose screen knows the settled set. It records once per
  distinct dish set, silently — the user did not ask for it and cannot act on it
  failing.

  This is why **`saved_count > 0` is not a filter anywhere any more.** It made
  sense while a menu could only be created BY a save (0 meant "everyone let
  go"); a recorded combination starts at 0 and would have been invisible from
  the moment it was written. `saved_count` still ORDERS all three reads, so the
  sheet's limit of 5 is the top five by favourites and unkept combinations fill
  the list only when there are not five kept ones.

  Consequence to know: the community queries are `refetchOnMount: "always"`, not
  `true`. `true` only refetches STALE data and these are REFERENCE tier — one
  hour — so a combination recorded a minute ago would not appear behind a dish's
  badge until the hour was up.
- **A menu is only an example once you could cook it** (`20260822000003`).
  `menu_is_publishable` requires every course to resolve to a real recipe, so a
  combination whose dishes are still suggestions stays out of the sheet, the
  home strip and compose retrieval.

  It is a READ rule, not a write rule, and both halves of that matter. It cannot
  be a write rule because `save_menu` is `record_menu` plus a reference, and
  favouriting a meal you just composed is exactly when its courses are not
  generated — refusing there would take the Saved tab's oldest behaviour away.
  And as a read rule it HEALS ITSELF: `dish_key` is immutable, so the menu joins
  the showcase the moment its last course is generated by anybody, with nothing
  rewritten.

  Safe to make it a subquery because it is the CURATION rule, called only by the
  three discovery reads. RLS uses `menu_is_visible`, a scalar over a stored
  column — so no policy reads `menu_courses` and none of `20260821000001`'s
  `42P17` recursion applies.
- **Composing records nothing; committing does.** The three commitments are the
  basket, the heart and Start Cooking, and each one also GENERATES what is still
  a suggestion — `useGenerateMenu` enqueues an ordinary generate job per course
  into the store that already runs above the navigator. One operation, three
  buttons: enqueueing a job id the store holds is a no-op, so a second press
  joins the run rather than starting another, and the bottom button reads
  `isGenerating` for its disabled state. That button is where
  "Start (1 of 3 ready)" used to be — a count that explained a limitation and
  offered nothing to do about it.

  **All three are held back while the composition is still streaming.** A menu
  filed mid-stream is whichever courses happened to land — a dinner nobody
  composed — and since every commitment now writes to the SHARED corpus, that is
  no longer just the user's own mistake to make.
- **Nothing in the UI may call a menu "yours".** A menu has no owner; a profile
  keeps a REFERENCE to one, and other people may keep the same row. So the card
  reports how many people keep it and, separately, whether the reader is one of
  them — "Saved by you", "You and 2 others", "1 person", and "Not saved yet" for
  a combination somebody composed and nobody has kept. It used to say "Your
  menu", which was true of the pre-shared model, and which also hid the very
  count the sheet ranks on. `savedCount === 0` must never render as "0 people":
  a combination is recorded the moment it is composed, so unkept means new, not
  rejected.
- **Clients cannot write `menus` or `menu_courses` at all.** SELECT policies
  only, plus an explicit `revoke insert, update, delete`. The revoke is not
  redundant: with RLS on and no write policy an UPDATE or DELETE matches zero
  rows and returns **204**, so a stale writer fails silently. Every write goes
  through `save_menu` (SECURITY DEFINER), which also READS the course snapshot
  off the catalogue rather than taking it from the caller — `menu_courses.name`
  and `image` are drawn on the home feed now.
- **Ownership is STORED, never derived.** A predicate that scans `menu_courses`
  from a policy on `menus` recurses (`42P17`) and, worse, fails OPEN when the
  private recipe is deleted. See the migration header.
- **`menu_courses.dish_key` is immutable and is what identity is computed over.**
  Nothing patches a course when its suggestion is promoted — the pointer is
  resolved on READ, by `menu_courses_resolved`. A server-verified reconcile
  cannot work here because `promote.ts` deliberately leaves
  `source_suggestion_id` NULL for an adapted variant.
- **`saved_count` is a denormalised counter** maintained by
  `sync_menu_saved_count`, which fires on insert, delete **and update** — the
  update arm is what keeps it honest when `save_menu` repoints a reference.
- **Compose RETRIEVES before it generates** (`20260822000001`). Asked for an
  appetizer to go with a main, `menu_pairings_for_recipe` returns what people
  have already paired with that dish, ranked by how many saved meals hold the
  pairing; only the shortfall reaches the model, and a fully-retrieved
  composition makes no LLM call at all (~40ms instead of seconds). Re-rolls walk
  down the ranking and fall through to the model when it runs out — that is what
  `exclude` is for, so **retrieval must apply it too**: skip that filter and the
  refresh button returns the same dish forever, because retrieval is
  deterministic where the model was stochastic.

  Three things about it are load-bearing. It is read by the **service role**, so
  the visibility rule is written into the function's own WHERE clause — its
  SECURITY INVOKER siblings would hand this caller private menus. It filters
  **blacklist and dietary in SQL**, because a retrieved dish was chosen by no
  model that was told either, and the two-branch dietary rule from
  `find_recipes` is required rather than optional: eight of the sixteen dietary
  tags have no `dietary_rules` row, so a `recipe_dietary`-only test returns
  nothing, forever and silently, to anyone on halal, keto or kosher. And a
  candidate dropped for `exclude`, blacklist, diet or an already-used dish
  **emits no `withdrawn` frame** — the slot is about to be generated, and a
  withdrawal would draw "Nothing to pair here" and then have the model's dish
  replace it.

  `COMPOSE_RETRIEVAL=off` restores the previous behaviour. A scoped switch
  because the request DTO cannot carry a flag — its JSON is the client's cache
  key and its background-job id — and **it should be deleted once this has run a
  week.**
- **A dish belongs to every menu it is IN, not just the ones it heads.**
  `community_menus_for_recipe` matches on `menu_courses.dish_key`, not on
  `main_recipe_id` (`20260821000006`), and the client's "yours" lookup filters
  the same way — on the courses, never on `mainRecipeId`. Getting this wrong is
  invisible from the dish a menu is built around and total from every other one:
  Roast Goose showed two menus while Braised Red Cabbage, a side in both,
  showed none. Menus built *around* the dish still rank first.

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
