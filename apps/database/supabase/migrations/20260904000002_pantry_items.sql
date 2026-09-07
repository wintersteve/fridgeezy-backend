------------------------------------------------------------------------------
-- pantry_items: what this cook probably has, and how sure we are
------------------------------------------------------------------------------
--
-- The fridge. `find_recipes` has been able to RANK by an inventory since
-- `20260902000001` (`p_pantry`), and nothing in the app held one — the
-- ingredient basket is a five-item AND filter cleared on every home focus.
-- This is the inventory that parameter was written for.
--
-- ## Confidence, and why it never reaches zero
--
-- An inventory nobody is paid to maintain is wrong within a week, so the
-- question is not "is this row true" but "how sure are we, and what does the
-- app do when it is unsure". Two answers were available:
--
--   1. Delete rows once they are old (a nightly cron, the shape this table had
--      before it was dropped for disuse).
--   2. Decay their confidence and keep them.
--
-- It is (2), and the reason is that **a deleted onion and an onion you are
-- unsure about are different states, and only one of them can be shown to the
-- user for correction.** A row that decays to "still got this?" is a question
-- the cook can answer in one tap. A row that was deleted at 3am is a fact the
-- app quietly lost, and the cook finds out by being recommended a dish they
-- cannot make.
--
-- So there is no cron, no delete job, and no expiry column. Confidence is
-- COMPUTED from age at read time (`pantry_confidence`), floors at
-- `PANTRY_CONFIDENCE_FLOOR`, and the only things that remove a row are the
-- cook saying so and the ingredient being deleted from the catalogue.
--
-- ## The clock is the ingredient's own shelf life
--
-- Which is why this migration is worth nothing without the shelf-life backfill
-- (`operations/backfill-shelf-life.ts`): 45 of 1041 ingredients carry
-- `default_shelf_life_days`, 360 carry the sentence it is derived from, and
-- until those are numbers every row decays on one flat default and a bag of
-- spinach is treated exactly like a jar of cumin.
--
-- ## `source` is what LAST touched the row, not where it came from
--
-- `first_seen_at` is where it came from. `source` is the most recent evidence,
-- which is what makes `cooked` a source rather than a contradiction: cooking
-- with an onion is evidence you HAD one and evidence you have less of it. See
-- `record_pantry_cooked`.
--
-- ## Written by the client, and that is a departure worth stating
--
-- `profile_taste_signals` is the model to copy for the WRITER'S MANNER —
-- observed rather than asked for, fire-and-forget, never between the user and
-- their first token — and this follows it. What it does not copy is that
-- table's "writable by nobody but the service role": a taste signal is fed to a
-- model and a pantry row is not, the two events that fill this table
-- (finishing a cook, scanning a photo) both settle on the DEVICE with no server
-- hop to hang a service-role write off, and a forged pantry row buys its forger
-- nothing but a worse ranking of their own feed. So RLS is the gate, as it is
-- for `shopping_lists`, and the RPCs below are SECURITY INVOKER over
-- `current_profile_id()` — they exist to keep the confidence arithmetic in one
-- place, not to be the boundary.

create table if not exists pantry_items
(
    id            uuid primary key                  default gen_random_uuid(),
    profile_id    uuid                     not null references profiles (id) on delete cascade,
    ingredient_id uuid                     not null references ingredients (id) on delete cascade,
    -- Text + check rather than an enum, following `recipes.origin` and
    -- `profile_taste_signals.kind`: widening a check is one migration, widening
    -- an enum is `alter type` and cannot be done inside a transaction with
    -- other DDL on some versions.
    source        text                     not null,
    -- Confidence AS OF `last_seen_at`, not now. What a reader wants is the
    -- decayed value, and that is a function of this and the age — storing the
    -- decayed number is what would need the cron this table exists without.
    confidence    real                     not null default 1,
    first_seen_at timestamp with time zone not null default now(),
    last_seen_at  timestamp with time zone not null default now(),

    constraint pantry_items_source_check
        check (source in ('shopped', 'cooked', 'scanned', 'declared')),
    constraint pantry_items_confidence_range
        check (confidence > 0 and confidence <= 1)
);

-- One row per ingredient per cook. Two rows for one onion is two answers to
-- "have I got an onion", and the decay would give them different ones.
create unique index if not exists pantry_items_profile_ingredient_unique
    on pantry_items using btree (profile_id, ingredient_id);

comment on table pantry_items is
    'What a cook probably has. Confidence decays with age and NEVER reaches zero — an uncertain row is shown for correction, where a deleted one is silently lost. See 20260904000002.';

comment on column pantry_items.source is
    'What last touched this row: shopped, cooked, scanned or declared. Provenance of the most recent evidence, not of the row — `first_seen_at` is that.';

comment on column pantry_items.confidence is
    'Confidence as of `last_seen_at`. The value a reader wants is `pantry_confidence(...)` over this and the row''s age; see the view `profile_pantry`.';

------------------------------------------------------------------------------
-- The arithmetic
------------------------------------------------------------------------------

-- The floor. A row can be doubted; it cannot be forgotten.
create or replace function public.pantry_confidence_floor()
    returns real
    language sql
    immutable
as
$function$
select 0.15::real;
$function$;

-- What an ingredient with no shelf life on file decays on.
--
-- Thirty days is a month of groceries: long enough that a store-cupboard row is
-- not questioned every week, short enough that a fridge row is. It is a
-- fallback rather than a default — the right number is the ingredient's own,
-- and this is what stands in until the backfill has run.
create or replace function public.pantry_default_shelf_life_days()
    returns integer
    language sql
    immutable
as
$function$
select 30;
$function$;

-- Confidence after `p_age_days`, halving every shelf life.
--
-- A HALF-LIFE rather than a straight line to zero, which is the same shape the
-- claim has: at the shelf life it is even money you still have the thing, and
-- past it the odds keep falling without ever becoming a certainty. A linear
-- ramp would hit zero on a date, which is the delete this design refuses.
--
-- `immutable`, and it takes the age rather than reading `now()`, so it can be
-- indexed, tested and reasoned about without a clock. The caller supplies the
-- age; the view below is the only thing that needs the clock.
create or replace function public.pantry_confidence(
    p_confidence real,
    p_age_days double precision,
    p_shelf_life_days integer
)
    returns real
    language sql
    immutable
as
$function$
select greatest(
               pantry_confidence_floor(),
               least(1.0, p_confidence)::double precision
                   * power(
                       0.5,
                       greatest(0, p_age_days)
                           / greatest(1, coalesce(p_shelf_life_days, pantry_default_shelf_life_days()))
                     )
       )::real;
$function$;

comment on function public.pantry_confidence(real, double precision, integer) is
    'Confidence decayed by age, halving every shelf life and floored at `pantry_confidence_floor()`. Never reaches zero: an uncertain row is a question for the cook, not a row to delete.';

-- The three states the app draws, named here so the client and the ranking
-- cannot disagree about where the lines are.
--
-- `uncertain` is the one that carries weight: it is what the pantry screen asks
-- about and what the feed declines to rank on. The other two are both "you have
-- this", drawn differently only so the cook can see which rows are getting old
-- before being asked about them.
create or replace function public.pantry_state(p_confidence real)
    returns text
    language sql
    immutable
as
$function$
select case
           when p_confidence >= 0.66 then 'fresh'
           when p_confidence >= 0.33 then 'likely'
           else 'uncertain'
       end;
$function$;

------------------------------------------------------------------------------
-- profile_pantry: the row as the app reads it
------------------------------------------------------------------------------
--
-- `security_invoker`, unlike `recipe_dietary` and the other catalogue views —
-- this one is per-profile, so it MUST see the world as the caller does or RLS
-- is bypassed by a select on a view. See `20260815000005`'s note on the
-- catalogue views for why they are the other way round.

create or replace view profile_pantry with (security_invoker = on) as
select pi.id,
       pi.profile_id,
       pi.ingredient_id,
       i.name                                                     as ingredient_name,
       i.category_id,
       c.name                                                     as category_name,
       pi.source,
       pi.first_seen_at,
       pi.last_seen_at,
       i.default_shelf_life_days,
       pantry_confidence(
           pi.confidence,
           extract(epoch from (now() - pi.last_seen_at)) / 86400.0,
           i.default_shelf_life_days
       )                                                          as confidence,
       pantry_state(pantry_confidence(
           pi.confidence,
           extract(epoch from (now() - pi.last_seen_at)) / 86400.0,
           i.default_shelf_life_days
       ))                                                         as state
from pantry_items pi
         join ingredients i on i.id = pi.ingredient_id
         left join categories c on c.id = i.category_id;

comment on view profile_pantry is
    'Pantry rows with their confidence decayed to now, the state the UI draws, and the ingredient''s name and category. security_invoker: RLS on pantry_items is what scopes it.';

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------
--
-- Owner-scoped on all four verbs, like `shopping_lists` and unlike
-- `profile_taste_signals` — see the header for why this table does not need
-- that one's service-role-only writer.

alter table pantry_items enable row level security;

drop policy if exists users_read_own_pantry on pantry_items;
create policy users_read_own_pantry on pantry_items for select
    using (profile_id = current_profile_id());

drop policy if exists users_write_own_pantry on pantry_items;
create policy users_write_own_pantry on pantry_items for insert
    with check (profile_id = current_profile_id());

drop policy if exists users_update_own_pantry on pantry_items;
create policy users_update_own_pantry on pantry_items for update
    using (profile_id = current_profile_id())
    with check (profile_id = current_profile_id());

drop policy if exists users_forget_own_pantry on pantry_items;
create policy users_forget_own_pantry on pantry_items for delete
    using (profile_id = current_profile_id());

------------------------------------------------------------------------------
-- record_pantry_scan: a photograph became rows
------------------------------------------------------------------------------
--
-- `POST /rest/ingredients/extract` already resolves what the camera saw against
-- the catalogue and returns ids, so a scan is a list of ingredient ids and one
-- confidence for the whole reading. That per-RESPONSE confidence is an honest
-- gap and is passed through as such: the endpoint does not report per item, so
-- neither does this.
--
-- Upsert rather than insert, and `last_seen_at` moves: seeing a thing again is
-- the strongest evidence available that it is still there, and it is what
-- restarts the decay.
--
-- **`first_seen_at` is deliberately left alone** on a conflict. It is the only
-- record of how long something has been in the kitchen, and a re-scan would
-- otherwise make every item look new every time the fridge was photographed.

create or replace function public.record_pantry_scan(
    p_ingredient_ids uuid[],
    p_confidence real default 1
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
    select v_profile_id,
           unnest(p_ingredient_ids),
           'scanned',
           greatest(0.01, least(1, coalesce(p_confidence, 1)))
    on conflict (profile_id, ingredient_id)
        do update set source       = 'scanned',
                      confidence   = excluded.confidence,
                      last_seen_at = now();

    get diagnostics v_written = row_count;

    return v_written;
end;
$function$;

comment on function public.record_pantry_scan(uuid[], real) is
    'Record a scanned fridge. Upserts, moves `last_seen_at` and leaves `first_seen_at` alone. SECURITY INVOKER: RLS scopes it to the caller.';

------------------------------------------------------------------------------
-- record_pantry_cooked: the consumption signal
------------------------------------------------------------------------------
--
-- Finishing a cook is the closest thing to a consumption event this app has,
-- and until now it was thrown away: the finish page offers to clear the
-- recipe's shopping list and nothing else is recorded.
--
-- **It knocks confidence down; it does not delete.** Cooking with an onion does
-- not mean the onion is gone — the recipe wanted one and you had three — so a
-- delete would be the app claiming something it cannot know. What it DOES know
-- is that it is now much less sure, which is exactly the state this table was
-- built to be able to hold. The row surfaces on the pantry screen as "still got
-- this?" and one tap settles it.
--
-- **It never CREATES a row.** A recipe's ingredient list includes things nobody
-- keeps a record of, and inventing pantry rows for a dish's whole shopping list
-- would fill the fridge with items the cook bought for it and used up. Only
-- what is already believed to be there is updated.
--
-- Idempotent by construction — it SETS a value rather than decrementing one —
-- so a cook who pages back and forth over the finish screen costs nothing.

create or replace function public.record_pantry_cooked(
    p_ingredient_ids uuid[]
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

    update pantry_items
    set source       = 'cooked',
        confidence   = greatest(pantry_confidence_floor(), 0.25::real),
        last_seen_at = now()
    where profile_id = v_profile_id
      and ingredient_id = any (p_ingredient_ids);

    get diagnostics v_touched = row_count;

    return v_touched;
end;
$function$;

comment on function public.record_pantry_cooked(uuid[]) is
    'Consumption signal from a finished cook. Knocks existing rows down to low confidence and stamps them `cooked`; never creates a row and never deletes one. Idempotent.';

------------------------------------------------------------------------------
-- confirm_pantry_item: the correction the decay exists to make possible
------------------------------------------------------------------------------
--
-- The other half of "decay, never delete". A row the app is unsure about is
-- only worth keeping if the cook can settle it in one tap, and this is that
-- tap: full confidence, the clock restarted, and the source becomes `declared`
-- because at that point the cook has said so and that outranks any inference.

create or replace function public.confirm_pantry_item(p_id uuid)
    returns void
    language sql
as
$function$
update pantry_items
set source       = 'declared',
    confidence   = 1,
    last_seen_at = now()
where id = p_id
  and profile_id = current_profile_id();
$function$;

comment on function public.confirm_pantry_item(uuid) is
    'The cook says this is still here: full confidence, clock restarted, source `declared`. SECURITY INVOKER over current_profile_id().';

grant execute on function public.pantry_confidence(real, double precision, integer) to anon, authenticated;
grant execute on function public.pantry_confidence_floor() to anon, authenticated;
grant execute on function public.pantry_default_shelf_life_days() to anon, authenticated;
grant execute on function public.pantry_state(real) to anon, authenticated;
grant execute on function public.record_pantry_scan(uuid[], real) to authenticated;
grant execute on function public.record_pantry_cooked(uuid[]) to authenticated;
grant execute on function public.confirm_pantry_item(uuid) to authenticated;
