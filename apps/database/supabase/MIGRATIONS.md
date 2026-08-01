# Consolidated migration baseline (DRAFT — not yet applied anywhere)

15 files replacing the 111 in `../migrations`, cut from **6,513 lines to 1,753**.

Derived by reading the **live database** (`qkxznjwlybjqpcauaisz`) through
`pg_catalog`, not by replaying the migration files — because the two had
diverged, and the files were the wrong answer. See "Drift" below.

## Layout

| File | Contents |
| --- | --- |
| `…0001_extensions_and_enums` | http, vector, pg_cron, pgsodium; the 5 enums |
| `…0002_canonical_id_helpers` | `normalize_to_canonical_id`, `singularize_token`, `ingredient_canonical_id`, `has_user` |
| `…0003_canonical_id_triggers` | the `set_*_canonical_id` trigger functions, `handle_new_profile`, `sync_recipe_favourite_count` |
| `…0004_reference_tables` | categories, units, tags, tag_aliases |
| `…0005_ingredients` | ingredients, ingredient_aliases |
| `…0006_cooking_actions` | cooking_action_categories, cooking_actions, cooking_action_aliases |
| `…0007_recipes` | recipes, recipe_ingredients, recipe_instructions, recipe_tags |
| `…0008_recipe_suggestions` | recipe_suggestions + its two join tables |
| `…0009_profiles` | profiles, settings, preferences, interactions, recipe_variants, the signup chain |
| `…0010_collections_and_shopping_lists` | collections, collection_recipes, shopping_lists |
| `…0011_search_functions` | the six `search_*` vector RPCs |
| `…0012_persist_functions` | `persist_suggestion`, `persist_recipe`, `persist_recipe_with_ingredient_ids` |
| `…0013_merge_functions` | `merge_ingredient`, `merge_recipe` |
| `…0014_find_recipes` | `find_recipes_result` composite + `find_recipes` |
| `…0015_storage_and_maintenance` | 4 storage buckets + policies, `delete_orphan_generated_recipes`, the cron job |

## Verified coverage

Checked against the live catalog, not eyeballed:

- **25 tables** — every live table except `pantry_items` (see below)
- **70 indexes** — set-equal to live, diffed by name in both directions, zero difference
- **25 functions**, **8 triggers**, **55 policies**
- All 5 enums, the `find_recipes_result` composite, 4 storage buckets, 1 cron job

## Deliberately dropped

- **`pantry_items`** and everything around it — table, 4 indexes, RLS policy,
  `set_pantry_item_expiration`, `delete_expired_pantry_items`, and the
  `delete-expired-pantry-items` cron job. `20260727000007_drop_pantry_items`
  has been in the repo for days but never ran on the remote (see Drift). It is
  unused by client and backend; 25 rows are in the backup.
- **`persist_recipe_with_ingredient_ids` 15-arg overload** — no caller. The
  repository passes `p_name_en`, so it binds the 16-arg form. Leaving both
  leaves PostgREST disambiguating on argument names, which is what
  `20260731000009` had to clean up for `persist_recipe`.
- `ingredient_pairings`, `ingredient_substitutes`, `prompts`, `prompt_variables`
  and the `generate_embedding*` helpers — already gone from the live database.

## Drift: why the files were not the source of truth

`20260727000007` is `drop_pantry_items` in the repo, but the remote recorded
that version as `dedupe_suggestions_against_recipes`. That migration was
originally numbered `…007`, got renumbered to `…011`, and `drop_pantry_items`
took the vacated number. The remote already had `…007` marked applied, so
`drop_pantry_items` was skipped and never will run.

Consolidating removes the whole class of problem: one baseline, no renumbering.

## Two live defects found during the consolidation

A consolidation must reproduce the schema exactly, so neither was fixed inside
the baseline itself.

1. **Ingredient canonical ids disagreed with themselves — FIXED in
   `20260801000016`.** `set_ingredient_canonical_id()` (the BEFORE INSERT
   trigger) did not singularise; `ingredient_canonical_id()` (what callers
   compute with) does. `persist_recipe` computes the singular form for its
   `ON CONFLICT (canonical_id)` target and the trigger overwrote it with the
   plural, so the conflict never matched and plural spellings produced duplicate
   ingredients — **170 of 729 rows** carried an id no lookup would find.

   The fix merges the duplicates (one group: `Shiitake Mushrooms` +
   `shiitake mushroom`), points the trigger at `ingredient_canonical_id()` so
   the two can never drift again, and backfills. Verified end-to-end: inserting
   `'Zzztest Berries'` now yields `zzztest_berry`, and a follow-up
   `ON CONFLICT` insert of `'zzztest berry'` reuses that row instead of creating
   a second one. `…0003` and `…0012` keep the original definitions on purpose —
   a reset replays them and then the fix.

2. **`handle_new_user()` is invisible to the repo.** It is fired by
   `on_auth_user_created` on `auth.users`, outside the public schema, and no
   file in this repository mentions it. It is included in `…0009_profiles`. Had
   it been dropped as "unreferenced", signup would create an account with no
   profile row.

## Verification — DONE

The structural DDL was replayed into a throwaway `consolidation_check` schema on
the same database (isolated from `public`, dropped afterwards), then its catalog
was diffed against production in both directions:

| Check | Result |
| --- | --- |
| Columns — name, type, nullability, generated-status, default | **0 differences** across 25 tables |
| Constraints — PK, FK, unique, check | **0 differences** |
| Indexes — names and definitions | **0 differences** (70 = 70) |

A preview branch was the intended vehicle, but `create_branch` needs a
`confirm_cost_id` and the `confirm_cost` tool is not exposed; `execute_sql` also
takes no project ref, so a branch could not have been queried anyway.

Two statements were excluded from the replay because they would have hit
production rather than the scratch schema: `create or replace function
public.handle_new_user()` (would overwrite the live function) and `create trigger
on_auth_user_created on auth.users` (would add a *second* signup trigger).
Verified afterwards that `auth.users` still carries exactly one trigger.

### What the replay caught

`recipes.canonical_id` is `GENERATED ALWAYS AS (normalize_to_canonical_id(name))
STORED`. The first draft declared it as a plain `text` column, because
`information_schema.columns` reports no `column_default` for generated columns
and that is where the column list came from. Left in, every insert would have
produced a NULL `canonical_id`, breaking the unique index, recipe dedupe, and the
suggestion filter in `find_recipes`. Fixed and re-verified.

Function *bodies* were not replayed — they were copied verbatim out of
`pg_get_functiondef`, so they are valid by construction. Their signatures were
cross-checked against `pg_get_function_identity_arguments`.

## Still to do

1. Swap `migrations.consolidated/` into `migrations/`.
2. `supabase migration repair --status applied` for each new version, so the
   remote records the baseline without re-running it.
3. Regenerate types (`nx run @fridgeezy/database:types`) and confirm nothing in
   `database.types.ts` moves except the removal of `pantry_items`.
4. Retake the data backup immediately beforehand — the app writes continuously
   (ingredients went 699 → 729 and recipes 14 → 28 during this work).
