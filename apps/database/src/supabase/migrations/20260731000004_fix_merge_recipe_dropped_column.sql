-- merge_recipe (20260729000002) repoints `recipe_suggestions.promoted_to_recipe_id`,
-- but that column was DROPPED in 20260126000001 — so the function has been broken
-- since it was written and failed with `column "promoted_to_recipe_id" does not
-- exist` the first time the dedupe-recipes backfill actually called it.
--
-- Exactly the same mistake 20260727000006 already had to fix in the orphan-cleanup
-- job, against the same dropped column.
--
-- The statement is simply removed rather than repointed: the modern link between a
-- suggestion and the recipe it became runs the other way (`recipes.source_suggestion_id`,
-- added in 20260731000001), and it lives on the recipe row — so when p_from is
-- deleted below there is nothing left to repoint. Everything else is unchanged.
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

    -- Remove the merged-away recipe (cascades its ingredients/instructions/tags).
    delete from recipes where id = p_from;
end;
$$;

comment on function merge_recipe is
'Folds recipe p_from into p_into: repoints collection_recipes, profile_recipe_interactions, shopping_lists, recipe_variants and base_recipe_id children, then deletes p_from (cascading its owned rows). Invoked by the dedupe-recipes backfill.';
