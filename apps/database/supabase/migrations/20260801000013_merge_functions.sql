-- Merge RPCs, used by the dedupe scripts to fold a duplicate row into its
-- keeper atomically.
--
-- The shape repeats throughout: repoint children with a NOT EXISTS guard so a
-- row that would violate the target's unique constraint is left behind, then
-- delete the stragglers. A plain UPDATE would abort the whole merge on the
-- first collision.

create or replace function public.merge_ingredient(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- recipe_ingredients: repoint, skipping rows that would collide with an
    -- existing (recipe_id, p_into) pair, then drop the leftover from-rows.
    update recipe_ingredients ri
       set ingredient_id = p_into
     where ri.ingredient_id = p_from
       and not exists (
           select 1 from recipe_ingredients ri2
            where ri2.recipe_id = ri.recipe_id
              and ri2.ingredient_id = p_into
       );
    delete from recipe_ingredients where ingredient_id = p_from;

    -- recipe_suggestion_ingredients: same conflict-safe repoint.
    update recipe_suggestion_ingredients rsi
       set ingredient_id = p_into
     where rsi.ingredient_id = p_from
       and not exists (
           select 1 from recipe_suggestion_ingredients rsi2
            where rsi2.recipe_suggestion_id = rsi.recipe_suggestion_id
              and rsi2.ingredient_id = p_into
       );
    delete from recipe_suggestion_ingredients where ingredient_id = p_from;

    -- Self-reference: children whose parent was p_from now point at p_into.
    update ingredients set parent_id = p_into where parent_id = p_from;

    -- recipe_instructions.ingredient_refs: replace p_from with p_into inside the
    -- UUID[] id array (de-duped; order is not significant for ingredient refs).
    update recipe_instructions
       set ingredient_refs = (
           select array_agg(distinct
               case when elem = p_from then p_into else elem end)
             from unnest(ingredient_refs) as elem
       )
     where p_from = any (ingredient_refs);

    -- ingredient_aliases: move p_from's aliases to p_into (dropping any that would
    -- collide on the unique alias), then record p_from's own name as an alias.
    update ingredient_aliases a
       set ingredient_id = p_into
     where a.ingredient_id = p_from
       and not exists (
           select 1 from ingredient_aliases a2
            where a2.alias = a.alias and a2.ingredient_id = p_into
       );
    delete from ingredient_aliases where ingredient_id = p_from;
    insert into ingredient_aliases (ingredient_id, alias)
        select p_into, i.name from ingredients i where i.id = p_from
        on conflict (alias) do nothing;

    -- Remove the merged-away ingredient.
    delete from ingredients where id = p_from;
end;
$function$;

create or replace function public.merge_recipe(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
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
$function$;
