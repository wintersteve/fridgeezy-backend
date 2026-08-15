# Recipe variants — Phase 1 backend contract

Everything the client needs to build the version selector, the rename/delete
affordances and the "make this my default" pin. Written for the client repo
(`/Users/steve/Projects/fridgeezy`); the *reasoning* behind each decision lives
in the migration headers and in CLAUDE.md's "Recipe variants" section.

Migrations: `20260815000002`, `20260815000003`, `20260815000004`. Applied to
local and to the linked dev project on 2026-08-15.

---

## 0. Before any of this reaches the app

`@fridgeezy/types` changed. The client pins a committed tarball, so nothing here
is visible to it until the lib is rebuilt, packed and reinstalled **by name**:

```bash
# in this repo
npx nx run-many -t build
cd libs/types && npm pack

# in the client
cp <tarball> vendor/fridgeezy-types.tgz
npm install @fridgeezy/types      # naming it explicitly — a bare install keeps the cached copy
```

`@fridgeezy/schemas` is **unchanged**. No request or response schema moved.

---

## 1. Schema

### `recipes` — one new column

| Column | Type | Notes |
| --- | --- | --- |
| `origin` | `text NOT NULL DEFAULT 'generated'` | `check (origin in ('generated','imported'))` |

- Index: `idx_recipes_origin_imported` — partial, `where origin <> 'generated'`.
- **Not** the same thing as `find_recipes_result.source`, which stays
  `'recipe' | 'suggestion'` (which table a feed row came from). Both now appear
  on a feed row. `origin` is NULL on suggestion rows.
- `is_generated` is now derived from it by the persist RPCs
  (`is_generated = (p_origin = 'generated')`). Behaviour is unchanged for
  everything writing today.
- Phase 2: an imported recipe is its own base (`base_recipe_id IS NULL`).

### `recipe_variants` — unchanged shape, new guarantees

| Column | Type | Notes |
| --- | --- | --- |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | **new**; stamped by trigger on every UPDATE |
| `label` | `text NOT NULL` | **new** `check (char_length(btrim(label)) between 1 and 80)` |

A `BEFORE UPDATE` trigger rejects any change to `profile_id`, `base_recipe_id`
or `recipe_id` with SQLSTATE `23001` (`restrict_violation`). Only `label` is
updatable. An `AFTER DELETE` trigger clears any `recipe_family_defaults` row
that pointed at the deleted variant.

### `recipe_family_defaults` — new table

```sql
id             uuid primary key default gen_random_uuid()
profile_id     uuid not null references profiles (id)  on delete cascade
base_recipe_id uuid not null references recipes  (id)  on delete cascade
recipe_id      uuid not null references recipes  (id)  on delete cascade
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()

unique (profile_id, base_recipe_id)          -- one default per family per user
index  (recipe_id)
```

RLS: `users_manage_own_recipe_family_defaults`, `FOR ALL`, scoped exactly like
`users_manage_own_recipe_variants`.

A `BEFORE INSERT OR UPDATE` trigger enforces what a check constraint cannot:

- `recipe_id = base_recipe_id` — **legal**, and means "pin the original".
- otherwise `recipe_id` must be a variant of `base_recipe_id`, else SQLSTATE
  `23503` "is not a variant of base".
- and that variant must be **saved** by this profile (a `recipe_variants` row),
  else SQLSTATE `23503` "is not saved by profile". Save first, then pin.

> `recipe_id = base_recipe_id` in **`recipe_variants`** is still corruption, not
> a pin. Do not write one there.

### `find_recipes_result` — one new attribute

`origin text` appended **last**, after `total_time_minutes`. `'generated'` /
`'imported'` on recipe rows, `NULL` on suggestion rows.

---

## 2. RPCs the client calls

All are `SECURITY INVOKER` — RLS is the gate, and the acting user is
`auth.uid()`, never a parameter. Call them with `supabase.rpc(...)`.

### Create a variant — *no new call*

Unchanged: the backend creates the variant recipe row and returns its id on the
SSE terminal frame; the client links it. What changed is only that **promote can
now produce one too** (see §3).

```ts
// existing useSaveRecipeVariant, unchanged
supabase.from("recipe_variants").upsert(
  { profile_id, base_recipe_id, recipe_id, label },
  { onConflict: "profile_id,recipe_id", ignoreDuplicates: false },
)
```

### Rename

```ts
const { data, error } = await supabase.rpc("rename_recipe_variant", {
  p_variant_id: string,   // recipe_variants.id
  p_label: string,
});
// data: RecipeVariant (the full updated row)
```

Trims and caps at 80 characters server-side. Errors:

| SQLSTATE | When |
| --- | --- |
| `23514` | label empty or whitespace only |
| `P0002` | no such variant **for this user** (one message for both cases on purpose) |

A direct `update({ label }).eq("id", …)` also works under RLS and the check
constraint. Prefer the RPC: it trims (`" Vegetarian"` sorting apart from
`"Vegetarian"` is invisible and gets reported as a bug) and it returns the row.

### Delete

Unchanged — `supabase.from("recipe_variants").delete().eq("id", id)`. Now also
retracts the pin if that variant was the default. The variant *recipe* row is
still left to the orphan sweep.

### Set default

```ts
const { data } = await supabase.rpc("set_recipe_family_default", {
  p_recipe_id: string,   // ANY recipe in the family — a variant, or the base
});
// data: RecipeFamilyDefault
```

Resolves the family itself, so the client never has to know which it is holding.
Idempotent; upserts, so a family cannot momentarily have two defaults. Pass the
base's id to mean "the original".

| SQLSTATE | When |
| --- | --- |
| `42501` | not signed in / no profile |
| `P0002` | no such recipe |
| `23503` | recipe is not in that family, or is an unsaved variant |

### Clear default

```ts
const { data } = await supabase.rpc("clear_recipe_family_default", {
  p_recipe_id: string,
});
// data: boolean — true if a pin was removed
```

"No preference" is **not** the same as pinning the base: a family with no row
follows whatever the app shows by default if that ever changes; a pin on the
base is a standing choice that outranks it.

### Read the default

```ts
const { data } = await supabase.rpc("get_recipe_family_default", {
  p_recipe_id: string,
});
// data: [{ base_recipe_id: string, default_recipe_id: string | null }]
```

**One row for any recipe that exists**, pinned or not: `default_recipe_id` is
null when unpinned, which is a different answer from an empty result. Zero rows
means only one thing — no such recipe.

Type: `RecipeFamilyDefault` from `@fridgeezy/types` for the write RPCs; this
read returns its own `{ base_recipe_id, default_recipe_id }` shape.

This replaces the first of the two queries `useRecipeVariants` currently makes
(the `recipe_variants` lookup that resolves the base) and is strictly better:
it resolves through `recipes.base_recipe_id`, so it works for a variant the user
has not saved. Suggested shape:

```ts
const { data: family } = await supabase.rpc("get_recipe_family_default", { p_recipe_id: recipeId });
const { base_recipe_id, default_recipe_id } = family[0];

const { data: variants } = await supabase
  .from("recipe_variants")
  .select("*")
  .eq("profile_id", profileId)
  .eq("base_recipe_id", base_recipe_id)
  .order("created_at", { ascending: true });
```

### Helper

`current_profile_id()` — the caller's profile id or null. Exposed because the
RPCs above use it; the client already has `useProfile`.

---

## 3. What changed on `POST /suggestions/:id/promote`

Same URL, same request schema, same frame types. Two behavioural changes:

1. **The reuse shortcuts now honour `blacklist`.** Previously, a dish already in
   the catalogue was handed straight back on a name match, whatever it contained.
   Now the whole family is checked and the first version the caller can eat is
   returned; if none can be, an adapted version is generated and stored as a
   variant of that family.

2. **The terminal `complete` frame may now carry `label`** — a string like
   `"Without peanuts"` or `"Adapted for you"` — exactly as
   `POST /recipes/modify` does. Its presence means **the recipe you were just
   handed is an unsaved variant**, and the client should offer to save it
   (`useSaveRecipeVariant` with `base_recipe_id` from
   `get_recipe_family_default`). A variant nobody saves is eventually reapable.

   `useGenerateRecipe` ignores unknown fields today, so nothing breaks before
   the client handles it — the user just loses the adaptation on their next
   visit and pays for it again.

Cost note: an adaptation is one extra LLM call, paid **once per family per
distinct restriction**. The second caller with the same allergy is served the
first caller's variant, because the check is on ingredients rather than on a
stored record of whose blacklist it was.

---

## 4. Not built, deliberately

- **No import endpoint.** `origin` is the column and its plumbing; Phase 2 owns
  the endpoint, and will also have to decide whether an imported recipe belongs
  in the shared `find_recipes` feed at all (it is visible there now, which is
  almost certainly not what is wanted — the column is exposed so the client or a
  filter can act on it).
- **No owner column on an imported recipe.** Phase 2 needs one; `recipes` has no
  `profile_id` today and adding one is a policy decision about the catalogue,
  not scaffolding.
- **No uniqueness on `label` within a family.** Two variants both called
  "Vegetarian" is confusing, not corrupt, and a rename that fails with a
  constraint violation is worse UX than a duplicate row in a list of three.
- **No REST endpoints for variant management.** It is all direct-to-Supabase
  under RLS, matching how the client's existing variant hooks already work.
  Nothing here needs an LLM, a secret, or server-side logic the database cannot
  express.
