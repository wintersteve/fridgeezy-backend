-- Merging two ingredients inside ONE recipe should COMBINE the amounts, not
-- discard one of them.
--
-- `merge_ingredient` repoints `recipe_ingredients` conflict-safely: rows that
-- would collide with an existing (recipe_id, p_into) pair are skipped, then
-- deleted. So a recipe listing both sides loses one quantity outright. Measured
-- on the live catalogue before the cleanup, exactly one row is affected —
-- "Apple Strudel" holds 40g Raisins and 20g Sultanas, and merging Sultanas into
-- Raisins would have silently produced a 40g strudel instead of a 60g one.
--
-- One row is not a reason to accept the behaviour: it is silent, it is wrong,
-- and it gets worse as the catalogue grows.
--
-- GUARDED TO IDENTICAL UNITS. Quantities are only summed when both rows carry
-- the same `unit_id`. No conversion is attempted and none should be — adding
-- 2 tbsp to 100 g requires a density this schema does not have, and guessing
-- would corrupt a recipe far more thoroughly than dropping a row does. Mixed
-- units keep the previous behaviour: the survivor's amount stands and the
-- duplicate's is dropped, which is why the cleanup operation prints every such
-- case rather than assuming this handles them.

create or replace function public.merge_ingredient(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- Combine amounts where the same recipe holds BOTH ingredients in the same
    -- unit. Runs BEFORE the repoint, while both rows still exist.
    update recipe_ingredients keep
       set quantity = keep.quantity + dup.quantity,
           -- Keep both comments when they differ; a merged line that says
           -- "finely chopped" and nothing else has lost half its instruction.
           comment = case
                         when dup.comment is null then keep.comment
                         when keep.comment is null then dup.comment
                         when keep.comment = dup.comment then keep.comment
                         else keep.comment || '; ' || dup.comment
               end
      from recipe_ingredients dup
     where keep.ingredient_id = p_into
       and dup.ingredient_id = p_from
       and dup.recipe_id = keep.recipe_id
       and dup.unit_id = keep.unit_id;

    -- recipe_ingredients: repoint, skipping rows that would collide with an
    -- existing (recipe_id, p_into) pair, then drop the leftover from-rows.
    -- Anything summed above is now a leftover and is removed here, its amount
    -- already carried across.
    update recipe_ingredients ri
       set ingredient_id = p_into
     where ri.ingredient_id = p_from
       and not exists (
           select 1 from recipe_ingredients ri2
            where ri2.recipe_id = ri.recipe_id
              and ri2.ingredient_id = p_into
       );
    delete from recipe_ingredients where ingredient_id = p_from;

    -- recipe_suggestion_ingredients: same conflict-safe repoint. No quantities
    -- on this table, so nothing to combine.
    update recipe_suggestion_ingredients rsi
       set ingredient_id = p_into
     where rsi.ingredient_id = p_from
       and not exists (
           select 1 from recipe_suggestion_ingredients rsi2
            where rsi2.recipe_suggestion_id = rsi.recipe_suggestion_id
              and rsi2.ingredient_id = p_into
       );
    delete from recipe_suggestion_ingredients where ingredient_id = p_from;

    -- profile_blacklisted_ingredients: repoint, conflict-safe. The FK is ON
    -- DELETE CASCADE, so without this the final delete destroys somebody's
    -- stated dietary restriction with nothing to report it.
    update profile_blacklisted_ingredients b
       set ingredient_id = p_into
     where b.ingredient_id = p_from
       and not exists (
           select 1 from profile_blacklisted_ingredients b2
            where b2.profile_id = b.profile_id
              and b2.ingredient_id = p_into
       );
    delete from profile_blacklisted_ingredients where ingredient_id = p_from;

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

    -- ingredient_aliases: move p_from's aliases to p_into, skipping any whose
    -- CANONICAL form is already claimed. Then drop what could not move.
    update ingredient_aliases a
       set ingredient_id = p_into
     where a.ingredient_id = p_from
       and not exists (
           select 1 from ingredient_aliases a2
            where a2.alias_canonical_id = a.alias_canonical_id
              and a2.id <> a.id
       );
    delete from ingredient_aliases where ingredient_id = p_from;

    insert into ingredient_aliases (ingredient_id, alias)
        select p_into, i.name from ingredients i where i.id = p_from
        on conflict (alias_canonical_id) do nothing;

    -- Rescue curated metadata before the row goes. Strictly a NULL-fill, so the
    -- surviving row's own values always win.
    update ingredients k
       set description      = coalesce(k.description, d.description),
           nutritional_info = coalesce(k.nutritional_info, d.nutritional_info),
           storage_tips     = coalesce(k.storage_tips, d.storage_tips),
           shelf_life       = coalesce(k.shelf_life, d.shelf_life),
           image_url        = coalesce(k.image_url, d.image_url),
           category_id      = coalesce(k.category_id, d.category_id)
      from ingredients d
     where k.id = p_into
       and d.id = p_from;

    delete from ingredients where id = p_from;
end;
$function$;
