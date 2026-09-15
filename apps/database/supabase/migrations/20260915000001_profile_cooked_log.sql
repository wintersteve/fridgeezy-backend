------------------------------------------------------------------------------
-- profile_cooked_log: the days a cook actually cooked
------------------------------------------------------------------------------
--
-- A durable, per-day record of cooking. The app has wanted one for a while and
-- has never had it — the planner's "cooking year" cannot be drawn without it,
-- and the three things that look like they would do are each wrong in a
-- different way:
--
--   1. `profile_recipe_interactions` has a `cooked` value in its enum, and it
--      is unique on `(profile_id, recipe_id, interaction_type)`. So it can hold
--      "the last time this dish was cooked", one row per dish, and cannot hold
--      a history: cook the same ragù in January and in June and the January
--      row is overwritten. Nothing writes it today either.
--   2. `shopping_lists.plan_cooked_at` is PLAN STATE, not history. It is what
--      advances the week's cursor, and `useRemoveFromPlan` and `useClearPlan`
--      both null it — clearing a week erases the record of having cooked it.
--      It also only ever covers dishes that were planned.
--   3. `pantry_items.source = 'cooked'` is ingredient-level and decays by
--      design. It says an onion was used, not that a meal happened on a day.
--
-- Hence a table whose only job is to remember. It is written from the cook
-- finish page, which already fires once per cook for planned and unplanned
-- dishes alike (`useRecordCookedIngredients`), so nothing new has to be asked
-- of the reader.
--
-- ## The day is the client's, not the server's
--
-- `cooked_on` is a DATE supplied by the device, and that is the whole point of
-- it being separate from `cooked_at`. Grouping a `timestamptz` by day on the
-- server groups it in UTC, which is the previous day for every reader west of
-- Greenwich for most of their evening — a dinner at 8pm in New York would land
-- on tomorrow's square. It is the same trap `plan_date` avoids by being a date
-- the client computes, and the same one `toISODate` exists for in the app.
--
-- `cooked_at` is kept beside it as the server's own view of when the row
-- arrived. Nothing reads it yet; it is what a future "what time do you cook"
-- question would need, and it costs 8 bytes.
--
-- ## Idempotent per day, by construction
--
-- One row per (profile, recipe, day). The writer is fire-and-forget and runs on
-- a screen the reader can page back onto, so the same cook can be reported more
-- than once — and a heatmap that counted those would shade a Tuesday darker
-- because somebody scrolled. Cooking the same dish twice in one day is one
-- entry; cooking it on two days is two, which is the distinction the chart is
-- actually about.
--
-- ## Nothing prunes it
--
-- `profile_prompts` keeps the newest 200 per profile and that is right for what
-- it is — evidence of what was asked, useful recently. This is the opposite: a
-- record whose value is precisely that it is long. A year of home cooking is a
-- few hundred rows of three columns, so there is nothing to reclaim and a prune
-- would be destroying the feature to save a page of disk.
--
-- ## Owner-written, like `pantry_items`
--
-- The event settles on the DEVICE with no server hop to hang a service-role
-- write off, nothing here is fed to a model, and a forged row buys its forger
-- nothing but a wrong picture of their own year. So RLS is the gate. No update
-- policy: a cook happened or it did not, and correcting one is a delete.

create table if not exists profile_cooked_log
(
    id         uuid primary key                  default gen_random_uuid(),
    profile_id uuid                     not null references profiles (id) on delete cascade,
    -- `set null` rather than `cascade`: a recipe leaving the catalogue must not
    -- take the evening with it. The day still happened, and the chart is about
    -- days.
    recipe_id  uuid                              references recipes (id) on delete set null,
    -- The reader's own local day. See the note above — this is not
    -- `cooked_at::date`.
    cooked_on  date                     not null,
    cooked_at  timestamp with time zone not null default now()
);

-- One row per dish per day. `recipe_id` is nullable, and Postgres treats NULLs
-- as distinct in a unique index — which is correct here: once a recipe is gone
-- there is nothing left to deduplicate on, and two orphaned rows on one day are
-- two meals that were genuinely cooked.
create unique index if not exists profile_cooked_log_profile_recipe_day_unique
    on profile_cooked_log using btree (profile_id, recipe_id, cooked_on);

-- The read is always "this profile, this span of days", ordered by day.
create index if not exists profile_cooked_log_profile_day_idx
    on profile_cooked_log using btree (profile_id, cooked_on desc);

comment on table profile_cooked_log is
    'A durable per-day record of cooking — the one thing `profile_recipe_interactions` (unique per dish) and `shopping_lists.plan_cooked_at` (nulled when a week is cleared) cannot be. See 20260915000001.';

comment on column profile_cooked_log.cooked_on is
    'The cook''s OWN local day, supplied by the client. Never `cooked_at::date` — that groups in UTC and puts an evening meal on tomorrow for every reader west of Greenwich.';

comment on column profile_cooked_log.recipe_id is
    'Nullable on purpose: `on delete set null`, so a recipe leaving the catalogue does not take the evening with it.';

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------

alter table profile_cooked_log enable row level security;

create policy users_read_own_cooked_log on profile_cooked_log for select
    using (profile_id = current_profile_id());

create policy users_write_own_cooked_log on profile_cooked_log for insert
    with check (profile_id = current_profile_id());

-- No update policy. A cook happened or it did not; correcting one is a delete.
create policy users_forget_own_cooked_log on profile_cooked_log for delete
    using (profile_id = current_profile_id());
