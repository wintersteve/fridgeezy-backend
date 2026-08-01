-- Make the ingredient canonical_id trigger agree with ingredient_canonical_id().
--
-- THE BUG
-- set_ingredient_canonical_id() stamped canonical_id with the plain rule
-- (lowercase, non-alphanumerics to underscore) while ingredient_canonical_id()
-- — what every caller computes with — additionally singularises the last token.
-- So "Cherry Tomatoes" was stored as `cherry_tomatoes` but looked up as
-- `cherry_tomato`.
--
-- persist_recipe made this concrete: it computes the singular form for its
-- ON CONFLICT (canonical_id) target, and the BEFORE INSERT trigger then
-- overwrote that value with the plural one, so the conflict never matched and a
-- second ingredient row was created for the same thing. 170 of 729 rows carried
-- an id no lookup would find.
--
-- Order matters below: merge first (while the OLD trigger is still installed, so
-- the updates merge_ingredient performs restamp to unchanged values), then swap
-- the trigger, then restamp. Doing it the other way round would hit the
-- canonical_id unique constraint mid-merge.

-- 1. Fold together rows that only differ by plurality. Written as a query over
--    the data rather than against specific ids, so it is a no-op on a fresh
--    database and re-runnable on any other.
--
--    The oldest row of each group wins, matching dedupe-ingredients.ts.
--    merge_ingredient repoints every reference (recipes, suggestions, instruction
--    ingredient_refs, child ingredients) and keeps the loser's name as an alias,
--    so the only thing lost is the duplicate's own metadata columns.
do $$
declare
    v_keep uuid;
    v_drop uuid;
begin
    for v_keep, v_drop in
        select keeper_id, dup.id
        from (
            select ingredient_canonical_id(name)                   as target_id,
                   (array_agg(id order by created_at))[1]          as keeper_id
            from ingredients
            group by ingredient_canonical_id(name)
            having count(*) > 1
        ) g
        join ingredients dup
          on ingredient_canonical_id(dup.name) = g.target_id
         and dup.id <> g.keeper_id
    loop
        raise notice 'merging ingredient % into %', v_drop, v_keep;
        perform merge_ingredient(v_drop, v_keep);
    end loop;
end
$$;

-- 2. The trigger now defers to the same helper every caller uses. Note it calls
--    ingredient_canonical_id() rather than repeating a regexp, so the two can
--    never drift apart again — which is exactly how this bug arose.
create or replace function public.set_ingredient_canonical_id()
    returns trigger
    language plpgsql
as $function$
begin
    new.canonical_id := ingredient_canonical_id(new.name);
    return new;
end;
$function$;

-- 3. Restamp the rows the old rule got wrong. The trigger fires on these updates
--    and computes the same value; the explicit SET keeps the intent readable.
update ingredients
set canonical_id = ingredient_canonical_id(name)
where canonical_id is distinct from ingredient_canonical_id(name);
