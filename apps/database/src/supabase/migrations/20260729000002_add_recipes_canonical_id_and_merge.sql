-- Duplicate generated recipes with identical names have slipped in: unlike
-- recipe_suggestions (which has a canonical_id unique constraint), the recipes
-- table has NO name/uniqueness guard, and duplicate prevention relied solely on
-- deleting a suggestion after it was promoted. That misses two cases:
--   1. concurrent promotion of the same suggestion (both generate before either
--      deletes), and
--   2. a fresh suggestion for a dish that already has a recipe (suggestion dedup
--      only compares against other suggestions, never against recipes).
--
-- Step one of the fix: give recipes a deterministic canonical_id so they can be
-- looked up (reuse-before-generate) and, in a follow-up migration — once the
-- existing duplicates have been merged with merge_recipe below — uniquely
-- constrained (partial, excluding variants). A generated column keeps
-- canonical_id always consistent with name, on every insert path.
alter table recipes
    add column canonical_id text
    generated always as (normalize_to_canonical_id(name)) stored;

create index idx_recipes_canonical_id on recipes (canonical_id);

comment on column recipes.canonical_id is
'Deterministic slug of name (normalize_to_canonical_id). Used to detect/prevent duplicate non-variant recipes. A partial unique index (WHERE base_recipe_id IS NULL) is added in a later migration once existing duplicates are merged.';

-- merge_recipe(p_from, p_into) folds the p_from recipe into p_into, atomically
-- repointing every reference, then deletes p_from. Driven by the dedupe-recipes
-- backfill (which decides WHICH rows to merge); this function only performs a
-- merge it is told to, in one transaction.
--
-- Recipe-owned children (recipe_ingredients, recipe_instructions, recipe_tags)
-- are ON DELETE CASCADE, so they drop with p_from — the keeper's own are kept.
-- References repointed here: collection_recipes, profile_recipe_interactions,
-- shopping_lists, recipe_variants (base + recipe), recipes.base_recipe_id
-- (child variants), and recipe_suggestions.promoted_to_recipe_id.
create or replace function merge_recipe(p_from uuid, p_into uuid)
returns void
language plpgsql
as $$
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- collection_recipes: repoint, skipping rows that would collide with an
    -- existing (collection_id, p_into) pair, then drop the leftovers.
    update collection_recipes cr
       set recipe_id = p_into
     where cr.recipe_id = p_from
       and not exists (
           select 1 from collection_recipes cr2
            where cr2.collection_id = cr.collection_id
              and cr2.recipe_id = p_into
       );
    delete from collection_recipes where recipe_id = p_from;

    -- profile_recipe_interactions: same conflict-safe repoint on
    -- (profile_id, recipe_id, interaction_type).
    update profile_recipe_interactions pri
       set recipe_id = p_into
     where pri.recipe_id = p_from
       and not exists (
           select 1 from profile_recipe_interactions pri2
            where pri2.profile_id = pri.profile_id
              and pri2.recipe_id = p_into
              and pri2.interaction_type = pri.interaction_type
       );
    delete from profile_recipe_interactions where recipe_id = p_from;

    -- shopping_lists: no uniqueness on recipe_id — repoint all.
    update shopping_lists set recipe_id = p_into where recipe_id = p_from;

    -- recipe_variants.recipe_id: conflict-safe repoint on (profile_id, recipe_id).
    update recipe_variants rv
       set recipe_id = p_into
     where rv.recipe_id = p_from
       and not exists (
           select 1 from recipe_variants rv2
            where rv2.profile_id = rv.profile_id
              and rv2.recipe_id = p_into
       );
    delete from recipe_variants where recipe_id = p_from;

    -- recipe_variants.base_recipe_id and recipes.base_recipe_id: child variants
    -- that pointed at p_from now point at the keeper.
    update recipe_variants set base_recipe_id = p_into where base_recipe_id = p_from;
    update recipes set base_recipe_id = p_into where base_recipe_id = p_from;

    -- recipe_suggestions still pointing at the merged-away recipe.
    update recipe_suggestions set promoted_to_recipe_id = p_into
     where promoted_to_recipe_id = p_from;

    -- Remove the merged-away recipe (cascades its ingredients/instructions/tags).
    delete from recipes where id = p_from;
end;
$$;

comment on function merge_recipe is
'Folds recipe p_from into p_into: repoints collection_recipes, profile_recipe_interactions, shopping_lists, recipe_variants, base_recipe_id children, and recipe_suggestions.promoted_to_recipe_id, then deletes p_from (cascading its owned rows). Invoked by the dedupe-recipes backfill.';
