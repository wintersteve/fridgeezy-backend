-- Drop a stale `persist_recipe_with_ingredient_ids` overload that only ever
-- existed on the deployed project.
--
-- ## What it is
--
-- A 15-argument version predating `p_name_en`, left behind when
-- `20260801000012` added that parameter. `create or replace function` cannot
-- replace a function with a different argument list — it creates a SECOND one —
-- and the drop that should have accompanied it named a signature this one does
-- not have.
--
-- It writes neither `name_en` nor (since 20260812000003) `identity_cuisine`.
--
-- ## Why it never showed up locally
--
-- It cannot. A `db reset` replays the migrations onto an empty database, so only
-- the current definition is ever created; the stale overload exists solely as
-- accumulated history on a long-lived project. `20260812000003` found it because
-- it counted overloads as part of its own verification — running the same count
-- locally returns 1 and always will.
--
-- **That is the general lesson, and it is worth more than this fix.** "It is
-- clean after a reset" says nothing about the deployed project, and function
-- overloads are the specific thing that diverges: every `create or replace` with
-- a changed signature adds one rather than replacing. `20260801000012`'s header
-- already records one round of this; this is the second.
--
-- ## Why it was not yet doing damage
--
-- PostgREST resolves overloads by argument NAME, and `persistWithIngredientIds`
-- always sends `p_name_en` (`recipe.nameEn ?? null` — the key is always present).
-- No call carrying `p_name_en` can match a function that has no such parameter,
-- so the 17-argument version won every time. The risk was latent: any future
-- caller omitting `p_name_en` would silently bind here instead and write a row
-- with a null identity_cuisine, which the new unique constraint reads as the
-- "unknown cuisine" copy of that dish.
--
-- Types only, and exactly fifteen of them — the current function takes
-- seventeen, so this cannot match it.

drop function if exists public.persist_recipe_with_ingredient_ids(
    text, text, difficulty_type, integer, text, text, integer, integer, integer,
    integer, text[], text, jsonb, jsonb, text[]);

-- Assert the postcondition rather than trusting the drop. A migration that
-- silently leaves two overloads standing is how this got here.
do $$
declare
    v_count integer;
begin
    select count(*) into v_count
    from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'persist_recipe_with_ingredient_ids';

    if v_count <> 1 then
        raise exception
            'expected exactly 1 persist_recipe_with_ingredient_ids, found %', v_count;
    end if;
end;
$$;

notify pgrst, 'reload schema';
