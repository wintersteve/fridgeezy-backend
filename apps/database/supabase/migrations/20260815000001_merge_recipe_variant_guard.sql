-- Refuse to merge a recipe that a user has saved a variant of, or from.
--
-- WHAT THIS PREVENTS, AND HOW IT IS KNOWN
-- On 2026-08-15 a manual dedupe of same-name/same-difficulty recipes destroyed
-- every row in `recipe_variants`. The reasoning that led there is the trap this
-- guard closes: duplicate rows were identified as "same name AND same
-- difficulty", which is exactly what a SAVED VARIANT looks like. `version-selector`
-- states the model plainly — "a difficulty rung is a version the system wrote, a
-- variant is one the user saved" — and a saved variant carries its base dish's
-- name and difficulty by construction. It is indistinguishable from a duplicate
-- by those two columns alone; the ONLY thing that tells them apart is a row in
-- this table.
--
-- The mechanism was quiet rather than dramatic. Merging a variant's `recipe_id`
-- into its own `base_recipe_id` repoints the variant onto the base, leaving
-- `recipe_id = base_recipe_id` — a row that still exists, still passes every
-- foreign key, and no longer refers to anything the user made. The recipe holding
-- the variant's actual content is deleted by the merge. Nothing errors.
--
-- WHY THE FUNCTION AND NOT A SCRIPT
-- There was no code path to fix: the dedupe was hand-written SQL. A guard that
-- only lives in a script protects only callers who use the script, which is the
-- opposite of who needs protecting. Here it binds every caller, including a human
-- at a psql prompt at the end of a long session.
--
-- DELIBERATELY BLUNT: it refuses if `p_from` appears in `recipe_variants` in
-- EITHER column. Merging a variant's base is less destructive than merging the
-- variant itself — `base_recipe_id` is repointed and the content survives — but
-- distinguishing the two costs more than it buys on an operation that is manual,
-- rare, and irreversible. Failing loudly and making the operator deal with the
-- variant explicitly is the right default. The message says how.
--
-- Note this cannot be a foreign key or a constraint: the rows are legal at every
-- point: it is the COMBINATION of a legal merge and a legal variant row that
-- destroys the data.
create or replace function public.merge_recipe(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
declare
    v_variant_labels text;
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- The guard. Before anything is repointed or deleted.
    select string_agg(distinct quote_literal(label), ', ')
      into v_variant_labels
      from recipe_variants
     where recipe_id = p_from
        or base_recipe_id = p_from;

    if v_variant_labels is not null then
        raise exception using
            errcode = 'restrict_violation',
            message = format(
                'merge_recipe: refusing to merge %s — a user has saved variant(s) of or from it (%s)',
                p_from, v_variant_labels
            ),
            hint = 'A saved variant shares its base dish''s name AND difficulty, so it looks like a duplicate and is not one. '
                   'Decide what happens to the variant first: delete the recipe_variants row to accept losing it, '
                   'or exclude this recipe from the merge to keep it.';
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

    -- recipe_variants.recipe_id / base_recipe_id: unreachable now that the guard
    -- above rejects any p_from this table references. Kept so the function stays
    -- correct on its own terms rather than depending on the guard staying put.
    update recipe_variants rv
       set recipe_id = p_into
     where rv.recipe_id = p_from
       and not exists (
           select 1 from recipe_variants rv2
            where rv2.profile_id = rv.profile_id
              and rv2.recipe_id = p_into
       );
    delete from recipe_variants where recipe_id = p_from;

    update recipe_variants set base_recipe_id = p_into where base_recipe_id = p_from;
    update recipes set base_recipe_id = p_into where base_recipe_id = p_from;

    -- Remove the merged-away recipe (cascades its ingredients/instructions/tags).
    delete from recipes where id = p_from;
end;
$function$;
