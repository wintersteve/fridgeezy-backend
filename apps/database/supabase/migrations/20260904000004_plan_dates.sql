------------------------------------------------------------------------------
-- A day for the dishes that have one, and a cursor for the ones that don't
------------------------------------------------------------------------------
--
-- `20260904000001` gave the plan an ORDER and deliberately no dates, on this
-- argument: "Cook Thursday's dish on Tuesday and a dated plan is wrong in two
-- places at once and has to be repaired before it is trustworthy again; an
-- ordered set does not notice, because it never claimed a day."
--
-- That argument is still right, and it is right about repair burden. What it
-- does not answer is the question a meal planner exists for — WHAT IS FOR
-- DINNER TONIGHT — which an ordered set cannot answer, because it does not know
-- it is Tuesday. These two columns answer it without giving the argument up.
--
-- ## The date is a VIEW over the slot; the slot stays the truth
--
-- `plan_date` is NULLABLE and nothing requires it. A dish with a date is drawn
-- on a day; a dish without one stays in the plan, still ordered, still shopped
-- for, sitting in an "any night" tray. So nothing is ever *required* to claim a
-- day, and nothing can therefore be wrong about a day it never claimed — which
-- dissolves the original objection rather than overruling it. **A plan with no
-- dates at all behaves exactly as it did before this migration.**
--
-- It also matches how the picking goes. People know Sunday is the roast and
-- Friday is quick; the middle three are "these, sometime". A grid that demands
-- five nights before it shows anything is asking for admin at the one moment
-- the reader was enthusiastic.
--
-- ## Nothing expires
--
-- There is no rollover job, no archive and no midnight decision, for the same
-- reason `pantry_items` has no nightly cron: a date that has passed stops being
-- DRAWN on the grid and its dish falls back into the tray, still planned and
-- still on the shop. The week degrades into the ordered set it started as.
--
-- ## `plan_cooked_at` is the cursor
--
-- The other half, and the half that serves everyone who never assigns a night:
-- the first slot nobody has cooked yet IS tonight. This is what makes that
-- derivable, and it is stamped from the cook-finish page — the same moment
-- `record_pantry_cooked` fires, and the only moment in the app where "this dish
-- happened" is unambiguous.
--
-- Deliberately a timestamp rather than a boolean: it is also the first record
-- this app keeps of WHEN something was cooked, which is what a past week would
-- eventually be built from.

alter table shopping_lists
    -- The day this dish is meant for. NULL is the ordinary case and means
    -- "this week, sometime" — never "unscheduled" in the sense of a problem.
    --
    -- `date`, not `timestamptz`: dinner is a day, not an instant, and a
    -- timestamp would drag a timezone into a column whose only reader is a grid
    -- of seven cells. A plan made in London and read in Lisbon should show the
    -- same dish on the same square.
    add column if not exists plan_date      date,
    -- When this dish was cooked, stamped by the finish page. Drives "up next"
    -- for a plan with no dates on it at all.
    add column if not exists plan_cooked_at timestamp with time zone;

comment on column shopping_lists.plan_date is
    'The day this planned dish is for, or NULL for "this week, sometime". A view over `plan_slot`, which stays the ordering — nothing requires a date, so nothing can be wrong about a day it never claimed. A past date is simply not drawn; nothing expires.';

comment on column shopping_lists.plan_cooked_at is
    'When this planned dish was cooked, stamped at the cook-finish page. The cursor: the first uncooked slot is "up next", which is how a plan carrying no dates still answers "what is for dinner".';

-- `plan_date` trails the existing plan index rather than getting one of its own:
-- every read is still "my rows, this plan", and the grid then buckets in the
-- client over at most a handful of rows.
create index if not exists idx_shopping_lists_profile_plan_date
    on shopping_lists using btree (profile_id, plan_id, plan_date);

------------------------------------------------------------------------------
-- record_plan_cooked
------------------------------------------------------------------------------
--
-- Called from the same place as `record_pantry_cooked` and for the same reason:
-- reaching the finish page is the one moment the app knows a dish was actually
-- made. Both are stamped there, neither is asked for, and neither blocks
-- anything the cook is doing.
--
-- Idempotent — it SETS a timestamp on rows that do not have one, so paging back
-- onto the finish screen neither re-stamps nor moves the record. Rows already
-- stamped are left exactly as they were, which is what keeps the cursor from
-- jumping when somebody re-reads a dish they cooked last week.
--
-- Scoped to PLANNED rows only. A dish cooked outside the plan is not evidence
-- about the plan, and stamping every shopping-list row would make a column
-- named `plan_cooked_at` mean something else entirely.

create or replace function public.record_plan_cooked(
    p_recipe_ids uuid[]
)
    returns integer
    language plpgsql
as
$function$
declare
    v_profile_id uuid := current_profile_id();
    v_touched    integer;
begin
    if v_profile_id is null then
        raise exception 'Not signed in';
    end if;

    update shopping_lists
    set plan_cooked_at = now()
    where profile_id = v_profile_id
      and plan_id is not null
      and plan_cooked_at is null
      and recipe_id = any (p_recipe_ids);

    get diagnostics v_touched = row_count;

    return v_touched;
end;
$function$;

comment on function public.record_plan_cooked(uuid[]) is
    'Stamp planned dishes as cooked, from the cook-finish page. Only rows in a plan, only rows not already stamped — so it is idempotent and the cursor cannot jump backwards.';

grant execute on function public.record_plan_cooked(uuid[]) to authenticated;
