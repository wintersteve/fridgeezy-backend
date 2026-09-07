------------------------------------------------------------------------------
-- record_pantry_shopped: ticking a shopping list fills the pantry
------------------------------------------------------------------------------
--
-- The third source, and the strongest one available: a line ticked on a
-- shopping list is a thing the cook has just put in a trolley. Nothing else in
-- the app produces evidence that good, and — unlike the camera — it costs the
-- reader nothing they were not already doing.
--
-- ## Why this is not `record_pantry_scan` with a different string
--
-- It is nearly the same statement, and the argument for a second function is
-- the same one `useShoppingListGroupActions` makes for being written separately
-- from its neighbours: these are different EVENTS, and the moment one of them
-- wants a different confidence, a different conflict rule or a different clock,
-- a shared function grows a mode parameter and both callers start reading a
-- branch that is not theirs. They are three lines each.
--
-- Full confidence, unlike a scan: a photograph is a model's reading of a shelf
-- and a tick is a person's hand on the thing.
--
-- ## What ticking does NOT mean
--
-- `useIngredientCheckStore` is ONE store shared by the shopping list, the
-- recipe screen and cook mode's mise en place — its own doc says so — so a tick
-- means "bought" on one surface and "measured out" on the other two, and
-- nothing in the row tells them apart. That ambiguity is why
-- `record_pantry_cooked` refuses to read the store at all. It is resolved by
-- the CALLER: only the shopping-list surfaces call this, because only they know
-- which sentence their tick is.

create or replace function public.record_pantry_shopped(
    p_ingredient_ids uuid[]
)
    returns integer
    language plpgsql
as
$function$
declare
    v_profile_id uuid := current_profile_id();
    v_written    integer;
begin
    if v_profile_id is null then
        raise exception 'Not signed in';
    end if;

    insert into pantry_items (profile_id, ingredient_id, source, confidence)
    select v_profile_id, unnest(p_ingredient_ids), 'shopped', 1
    on conflict (profile_id, ingredient_id)
        do update set source       = 'shopped',
                      confidence   = 1,
                      last_seen_at = now();

    get diagnostics v_written = row_count;

    return v_written;
end;
$function$;

comment on function public.record_pantry_shopped(uuid[]) is
    'Record a shop. Upserts at full confidence and restarts the clock; leaves `first_seen_at` alone, so re-buying something does not make it look new. Called only from the shopping-list surfaces — see the migration on why the tick store cannot be read directly.';

grant execute on function public.record_pantry_shopped(uuid[]) to authenticated;
