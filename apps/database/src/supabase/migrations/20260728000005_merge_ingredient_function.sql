-- Phase 2 (ingredient canonicalization) — slice 4: safe ingredient merge.
--
-- merge_ingredient(p_from, p_into) folds the p_from ingredient into p_into,
-- atomically repointing every reference and recording p_from's name as an alias
-- of p_into, then deleting p_from. Driven by the dedupe-ingredients backfill
-- (which decides *which* rows to merge); this function only performs a merge it
-- is told to, in one transaction.
--
-- References handled: recipe_ingredients, recipe_suggestion_ingredients (both
-- unique per parent — collisions are dropped, not duplicated), the self-
-- referential ingredients.parent_id, recipe_instructions.ingredient_refs (a JSONB
-- id array), and ingredient_aliases.

create or replace function merge_ingredient(p_from uuid, p_into uuid)
returns void
language plpgsql
as $$
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
    -- JSONB id array (de-duped; order is not significant for ingredient refs).
    update recipe_instructions
       set ingredient_refs = (
           select jsonb_agg(distinct
               case when elem = to_jsonb(p_from::text)
                    then to_jsonb(p_into::text)
                    else elem
               end)
             from jsonb_array_elements(ingredient_refs) as elem
       )
     where ingredient_refs @> to_jsonb(array[p_from::text]);

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
$$;

comment on function merge_ingredient(uuid, uuid) is
'Fold ingredient p_from into p_into: atomically repoint recipe_ingredients,
recipe_suggestion_ingredients, ingredients.parent_id, recipe_instructions
.ingredient_refs, and ingredient_aliases; record p_from''s name as an alias of
p_into; then delete p_from. No-op when p_from = p_into or either is null.';
