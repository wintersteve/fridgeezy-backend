# Recipe import — Phase 2 backend contract

Everything the client needs to build "photograph a recipe and keep it": the
endpoint, its frames, its failure modes, and the ownership rules that now govern
which recipes a user can see at all. Written for the client repo
(`/Users/steve/Projects/fridgeezy`); the *reasoning* behind each decision lives
in the migration headers, in `read-recipe-from-image.ts` and in `import-recipe.ts`.

Migrations: `20260815000005`, `20260815000006`. Applied to local and to the
linked dev project on 2026-08-15.

---

## 0. Before any of this reaches the app

`@fridgeezy/types` **and** `@fridgeezy/schemas` both changed. The client pins
committed tarballs, so nothing here is visible to it until both are rebuilt,
packed and reinstalled **by name**:

```bash
# in this repo
npx nx run-many -t build
cd libs/types   && npm pack
cd ../schemas   && npm pack

# in the client
cp <tarballs> vendor/
npm install @fridgeezy/types @fridgeezy/schemas   # named explicitly — a bare install keeps the cached copies
```

- `@fridgeezy/types` — `recipes.created_by` on Row/Insert/Update,
  `persist_recipe_with_ingredient_ids` gained `p_created_by`, and
  `recipe_is_visible` appears under Functions.
- `@fridgeezy/schemas` — new `ImportRecipeRequestSchema`,
  `ImportRecipeRejectionSchema` and `ImportRejectionCodeSchema`, exported from
  `@fridgeezy/schemas` alongside the other recipe schemas.

(`libs/types` also picked up `profile_taste_signals` from `20260815000007`, which
is a different workstream — see §7.)

---

## 1. The endpoint

```
POST /rest/recipes/import
Authorization: Bearer <supabase access token>     ← required, no exceptions
Content-Type: application/json
```

Account tier. **Not** behind `requireEntitlement` — it is one vision call, and
what it produces is content the user brought in rather than content this app
wrote for them. Making it premium is one line in `recipes.routes.ts`.

### Request

Byte-identical in shape to `POST /rest/ingredients/extract`, so the client's
existing encode-and-post half (`use-extract-ingredients`) is reusable:

```jsonc
{
  "image": "<base64 bytes, no data: prefix>",
  "imageType": "base64",        // optional, default "base64"; "url" also accepted
  "mimeType": "image/jpeg"      // optional, default "image/jpeg"; png | gif | webp
}
```

There is deliberately **no `servings`, `blacklist` or `dietaryRestrictions`**.
This endpoint reads a recipe that already exists rather than writing one: the
yield comes off the page, and a user who wants the dish changed runs
`/rest/recipes/modify` on the result. See `import-recipe.schema.ts`.

### Response — SSE, the same frames the recipe screen already parses

`text/event-stream`, terminated by `data: [DONE]`. The frame sequence and shapes
are the ones `POST /suggestions/:id/promote` and `POST /recipes/modify` emit, so
the existing recipe assembler works unchanged.

| # | Frame | Notes |
| --- | --- | --- |
| 1 | `initial` | `name`, `nameEn`, `difficulty`, `servings`, `tags`, `origin: "imported"` |
| 2 | `header` | `description`, `shortDescription`, `prepTime`, `cookTime`, `servings` |
| 3 | `nutrition` | `kcal`, `carbs`, `protein`, `fat` — estimated per serving (see §4) |
| 4..n | `tip` | 0–3, only if the page printed them |
| … | `ingredient` | `name`, `category`, `parent`, `quantity`, `unit`, `comment?`, `ingredientId` |
| … | `instruction` | `text`, `ingredients[]`, `ingredientIds[]`, `durationSeconds?`, `temperatureC?`, `equipment?` |
| last | `complete` | `saved`, `id`, `recipe`, `origin: "imported"`, `confidence` |

Three things worth knowing:

- **`servings` is READ OFF THE PAGE**, unlike every other recipe stream where it
  echoes the caller's preference. Take it from the frames; there is no request
  parameter to fall back on. It is on `initial` *and* `header` because the
  existing assembler reads it from `header`.
- **`origin: "imported"` is on the first frame**, so a screen can badge the
  recipe before it has any content.
- **`confidence`** (`high` | `medium` | `low`) is on the terminal frame — the
  model's own account of how much it could read. A `low` read is a good moment to
  prompt "check the quantities" rather than presenting a shaky transcription as
  fact.

**The frames arrive together, in a burst, not trickling.** The read is one
blocking vision call and the frames are replayed from it — see §3 for why that is
deliberate. Nothing in the contract depends on it: if the read is ever switched
to a streaming prompt, frames start arriving live and the client does not change.

---

## 2. Failure modes

All of these are decided **before** the stream opens, so they are real HTTP
statuses with a body, not frames. Branch on the status; use `code` to pick
wording.

| Status | `code` | Means | What the user should do |
| --- | --- | --- | --- |
| 400 | — (Zod error string) | Malformed body | — (client bug) |
| 401 | `Unauthorized` | No/invalid token | Sign in |
| 401 | `no_profile` | Authenticated, but no profile row resolved | Retry; support case if it persists |
| 422 | `not_a_recipe` | Legible, and holds no recipe | **Different page.** Retrying this photo cannot help |
| 422 | `unreadable` | Plausibly a recipe, not readable — blur, glare, a fold, cut off | **Another photo of the same page.** Very likely works |
| 500 | `ingredient_resolution_failed` | The read succeeded; the catalog match did not | Retry |
| 502 | `read_failed` | No response, or malformed output, from the vision model | Retry |

Body shape:

```jsonc
{ "error": "This image could not be read clearly enough",
  "code": "unreadable",
  "detail": "the ingredient list is cut off at the left margin" }   // optional, diagnostic
```

`error` is the human-readable line and matches the existing convention (`error`
is a string everywhere in this API); `code` is what to branch on; `detail` is the
model's own description of what it saw, useful in a log and safe to show but
written for a developer.

One failure lands **on the stream**, because it happens after the frames: if
persistence fails, the terminal frame is
`{ "type": "complete", "saved": false, "error": "...", "recipe": {...} }`. It
still carries the recipe, so the screen can offer a retry over content the user
has already been shown rather than dropping it.

### Verified against the running API (2026-08-15, local)

| Input | Result |
| --- | --- |
| Rendered Ribollita page | 200, 11 ingredients matched to catalog ids, 5 steps, saved |
| Shopping list | 422 `not_a_recipe` — "a shopping list, no method or ingredient list" |
| The same recipe page, heavily blurred | 422 `unreadable` |
| No `Authorization` header | 401 |
| `{"imageType":"base64"}` | 400 |

---

## 3. The vision read

**Model:** `gpt-4o`, via `@fridgeezy/llm`'s `generateCompletion` with `json: true`
and `image`. The same model `POST /ingredients/extract` uses — the tasks are the
same shape (one image in, one JSON object out), and a second vision model to keep
an eye on needs a measured reason. Capped at 6000 output tokens (16000 on
Bedrock, clearing its thinking allowance).

**Prompt approach: transcription, not generation.** Every other recipe prompt in
this repo asks the model to *write* a dish; this one asks it to *read* one, and
the two want opposite instincts. A generator filling a gap with something
plausible is doing its job; a transcriber doing it has silently replaced the
user's grandmother's method with the model's average of every method like it, and
nothing downstream can tell. So the prompt says "use the quantities printed on the
page", "do not add a step the page does not have", "do not improve the method"
and "prefer unreadable over guessing" — repeated at each point the temptation
arises, because one "be faithful" at the top does not survive a smudged line.

Two places invention **is** allowed, both bounded:

- **Nutrition**, because pages almost never print it and the four columns are
  NOT NULL. Bounded: it is arithmetic over an ingredient list that *is* on the
  page. The alternative is storing zeros the recipe screen draws as real.
- **A quantity for an unmeasured ingredient** ("salt to taste"), because
  `recipe_ingredients.quantity` is NOT NULL. Bounded by forcing the printed
  wording into `comment`, so the screen still reads "to taste".

The prompt carries the same closed vocabularies the generators use — units, tags,
ingredient categories — because persistence resolves against them: an unknown
unit abbreviation raises inside the persist RPC and takes the whole import with
it.

**Why the read finishes before the stream opens.** "This is a photo of a cat" and
"this page is out of focus" are the two most likely outcomes of the whole feature.
Once `createStreamHandler` opens the stream it has committed to a 200 and a
failure can only be a frame — which every client then has to branch on before it
looks anything up. Deciding first buys a real 422 with a code. And reading is not
incremental anyway: the model must see the whole page before it knows whether
there is a recipe on it.

**Ingredients go through `matchIngredients`** — the same TS pipeline
`/ingredients/extract` uses (canonical id → alias → vector search → LLM
adjudication, creating only what genuinely isn't there). That is why every
`ingredient` frame carries an `ingredientId` and every `instruction` carries
`ingredientIds`: the step→ingredient links work on an imported recipe exactly as
they do on a generated one.

**Hero art** is generated on the same terms as any other recipe: fire-and-forget,
at a path derived from the dish NAME, short-circuiting on an existing object. No
part of the user's page reaches the image model.

---

## 4. Ownership

### The model, in one sentence

`recipes.created_by IS NULL` means the shared catalogue; a non-null `created_by`
means exactly one profile can see it.

| Column | Type | Notes |
| --- | --- | --- |
| `created_by` | `uuid NULL references profiles(id) on delete cascade` | NULL = shared catalogue |

- `check (origin <> 'imported' or created_by is not null)` — **imported implies
  owned**, enforced. Every consumer may therefore scope on `created_by` alone and
  never also test `origin`.
- The converse is deliberately unconstrained: `created_by` on a generated row is
  not a contradiction, it is the shape a future "my private variant" would take.
  Nothing writes it today.
- Index `idx_recipes_created_by`, partial `where created_by is not null`.
- Deleting a profile deletes their imports (cascade). Verified.

**Generated and catalogue recipes are unchanged**: `created_by IS NULL`,
world-readable to `anon` and `authenticated`, same feed behaviour. `modify` and
`escalate` still write shared variants. An import is its own base
(`base_recipe_id IS NULL`) and can carry variants of its own.

### The rule is written once

`recipe_is_visible(created_by)` — `p_created_by is null or p_created_by =
current_profile_id()`. It has to hold in six places and a divergence between any
two is a silent leak rather than an error, so they all call the one function.

### Where it is enforced

| Surface | How |
| --- | --- |
| `recipes` (direct client reads) | RLS `public_read` now `using (recipe_is_visible(created_by))` |
| `recipe_ingredients`, `recipe_instructions`, `recipe_tags` | RLS resolving visibility through the parent — hiding the recipe row alone leaves the whole content readable to anyone with the id |
| `find_recipes` | Explicit predicate in `matching_recipes`. It is SECURITY DEFINER and never consults a policy |
| `search_recipes` | `and r.created_by is null` — dedup is about the shared catalogue, whoever is asking |
| API routes taking a recipe id | `callerMayReadRecipe` in `modify`, `escalate`, `compose`, `chat`, `substitutes` — these read as the service role, past RLS |
| `GET /recipes/:id/share` | 404 for any owned recipe (see below) |

An audit script proves it end to end rather than by reading definitions back:

```bash
npx nx run @fridgeezy/database:check-recipe-visibility     # 7 passed, 0 failed
```

### `recipes_dish_identity_difficulty_unique` no longer covers owned rows

Its predicate is now `where (base_recipe_id is null and created_by is null)`.
That constraint is a statement about the *catalogue* — it stops promotion writing
a second "Lasagna". Without this change, the first user to photograph a lasagna
gets a row and every user after them gets a unique-violation on a dish the
catalogue already knows. Two people owning their own copy of one dish is the
normal case for user-authored content.

### `/share` refuses owned recipes

`GET /rest/recipes/:id/share` answers **404** for anything with a `created_by`,
using the same body a missing recipe gets. The route is open precisely because
its caller is not the app — iMessage, Slack and the tapper's browser hold no
Supabase session — so there is nobody to compare an owner against and the choice
is "everyone" or "no one". Sharing an import is buildable (a signed, expiring
token minted by the owner through an authenticated route); it is a product
decision, not a technical limit. **Do not open the read.**

### What is NOT covered, and is recorded as accepted

`recipe_display_tags` and `recipe_dietary` are views created without
`security_invoker`, so they run as their owner and see past the policies. What
they expose for an owned recipe is its **tag names**, keyed by an id the reader
must already hold — not the recipe, its ingredients or its steps. Flipping them
is a behaviour change for every existing caller (including `find_recipes`, which
reads them from inside its own definer context) and belongs in its own migration.

---

## 5. Feed filtering

`find_recipes` gained one predicate, first in the `matching_recipes` WHERE
clause:

```sql
recipe_is_visible(r.created_by)
```

Filtered **there** rather than at the end on purpose: it happens before
`family_picks` collapses a dish to one row, so an owned variant cannot win the
pick and take a catalogue dish out of somebody else's feed with it.

`current_profile_id()` works inside a SECURITY DEFINER function — the definer
switch changes the effective role, not the `request.jwt.claims` GUC that
`auth.uid()` reads. A guest resolves to NULL and sees exactly the unowned
catalogue.

Measured on local, with two real imports owned by one profile:

| Caller | `find_recipes` total | of which imported |
| --- | --- | --- |
| Owner | 37 | 2 |
| Another signed-in user | 35 | 0 |
| Guest (anon) | 35 | 0 |

The client's own `ilike` search (`use-fts-search-recipes`) goes straight at the
`recipes` table, so it picks a user's imports up automatically through RLS — no
client change needed for that, and it is the intended behaviour.

Imported recipes get **no dish-signature embedding**. `fts` feeds
`search_recipes`, which now excludes owned rows by definition, so writing one
would be an OpenAI call per import whose only reader has been told to ignore it.
Nothing the user can see depends on it.

---

## 6. What the client needs to do

1. Rebuild + repack **both** tarballs (§0). Nothing below is visible otherwise.
2. Build the import screen against `POST /rest/recipes/import`, reusing the
   ingredient-extract uploader for the payload and the recipe SSE assembler for
   the frames.
3. Take `servings` from the stream, not from the profile preference.
4. Branch the two 422 codes into different copy — "try a different page" vs "try
   another photo". They are the two most likely outcomes and they need different
   buttons.
5. Badge imported recipes. `origin` is already on `find_recipes` rows and on the
   `initial`/`complete` frames.
6. Consider surfacing `confidence: "low"` as a "check the quantities" nudge.
7. Nothing to change for visibility — RLS does it. A user's imports appear in
   their own feed and searches and nowhere else.

---

## 7. Not part of this work

`20260815000007_profile_taste_signals.sql`, its repository and the
`profile_taste_signals` entity type are a separate workstream that appeared in
this working tree mid-change. It was applied to the linked dev project by
`up-remote` along with the two migrations above — see the note in the handover.
