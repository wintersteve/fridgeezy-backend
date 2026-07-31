-- Airtight guard against duplicate non-variant recipes (see 20260729000002 for
-- the background: canonical_id column, merge_recipe, reuse-before-generate).
--
-- MUST be applied only AFTER existing duplicates have been merged:
--   DEDUP_APPLY=true npx nx run @fridgeezy/database:dedupe-recipes
-- otherwise this CREATE UNIQUE INDEX fails on the leftover duplicate rows.
--
-- Partial: variants (base_recipe_id set) intentionally share their base's name,
-- so only canonical (non-variant) recipes are constrained. With this in place a
-- second insert of the same dish raises a unique_violation, which the promote
-- flow catches and turns into a reuse of the row that won the race.
create unique index recipes_canonical_id_unique
    on recipes (canonical_id)
    where base_recipe_id is null;
