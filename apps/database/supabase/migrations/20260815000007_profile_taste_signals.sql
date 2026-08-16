------------------------------------------------------------------------------
-- profile_taste_signals: what this cook keeps asking for
------------------------------------------------------------------------------
--
-- Every other personalisation table in this schema stores something the user
-- DECLARED: `profile_settings` holds the servings they picked,
-- `profile_dietary_preferences` the diets they ticked,
-- `profile_blacklisted_ingredients` the things they said they cannot eat. This
-- one stores what they REVEALED — the modification they type on every third
-- recipe, the direction they always push the difficulty, the ingredient they
-- are forever swapping out.
--
-- Those signals already flow through the API on their way to a model and are
-- then dropped on the floor. `POST /recipes/modify` sees the instruction,
-- `POST /recipes/difficulty/escalate` sees the direction,
-- `POST /substitutes/generate` sees what was missing. Nothing was written back,
-- so the app started every request knowing exactly as much about the cook as it
-- did on the day they installed it.
--
-- ## One row per (profile, kind, value), counted
--
-- The unique index is the design, not an optimisation. A taste signal is only
-- worth acting on when it REPEATS: "make this one vegetarian" is a fact about a
-- dinner party, "make it vegetarian" for the fifth time is a fact about the
-- cook. Storing occurrences rather than an event log is what lets the reader
-- tell those apart, and it keeps the table bounded by how many distinct things
-- a person asks for rather than by how often they cook.
--
-- The threshold at which a count becomes a preference lives in TypeScript
-- (`TASTE_SIGNAL_MIN_OCCURRENCES`), not here — see the note on that constant for
-- why it is a product decision rather than a fitted one.
--
-- ## Deliberately NOT keyed on a recipe
--
-- A signal is about the cook, not the dish. Adding `recipe_id` would make the
-- unique key per-recipe, which is the one shape that cannot answer the question
-- this table exists for ("what does this person always do?") — every row would
-- have an occurrence count of 1.

create table if not exists profile_taste_signals
(
    id            uuid primary key                  default gen_random_uuid(),
    profile_id    uuid                     not null references profiles (id) on delete cascade,
    -- Text + check rather than an enum, following `recipes.origin`: widening a
    -- check constraint is one migration, widening an enum is `alter type` and
    -- cannot be done inside a transaction with other DDL on some versions.
    kind          text                     not null,
    -- Canonicalised by the caller (`canonicalizeName`), so "Make it spicier",
    -- "make this spicier" and "SPICIER" collapse onto one row. Storing the raw
    -- text would give every phrasing its own row and no count would ever reach
    -- the threshold.
    value         text                     not null,
    occurrences   integer                  not null default 1,
    first_seen_at timestamp with time zone not null default now(),
    last_seen_at  timestamp with time zone not null default now(),

    constraint profile_taste_signals_kind_check
        check (kind in ('modification', 'difficulty', 'substitution')),
    constraint profile_taste_signals_occurrences_positive
        check (occurrences > 0)
);

create unique index if not exists profile_taste_signals_profile_kind_value_unique
    on profile_taste_signals using btree (profile_id, kind, value);

comment on table profile_taste_signals is
    'Revealed cooking preferences, counted. Written only by the API (service role); see record_taste_signal.';

------------------------------------------------------------------------------
-- RLS: readable and forgettable by the owner, writable by nobody
------------------------------------------------------------------------------
--
-- Select and delete only, mirroring `profile_entitlements`' "select policy and
-- deliberately no insert/update/delete" for the same reason: the value of the
-- row comes from it being an honest record of what happened. A client that can
-- insert can hand itself preferences it never earned, and one that can update
-- can inflate an occurrence count past the threshold in a single call.
--
-- Delete IS granted, and that is the one difference from entitlements. This is
-- inferred data about a person, so "forget that I ever asked for this" has to be
-- possible without a support request — and unlike an entitlement, a deleted
-- signal costs nobody anything. It is also self-repairing: if the cook still
-- wants the thing, they will ask for it again and the row comes back.

alter table profile_taste_signals enable row level security;

create policy users_read_own_taste_signals on profile_taste_signals for select
    using (profile_id = current_profile_id());

create policy users_forget_own_taste_signals on profile_taste_signals for delete
    using (profile_id = current_profile_id());

------------------------------------------------------------------------------
-- record_taste_signal: upsert-and-count
------------------------------------------------------------------------------
--
-- An RPC rather than a supabase-js `.upsert()` because the update half has to
-- read the row it is updating (`occurrences + 1`), which PostgREST's upsert
-- cannot express — it can only overwrite with the values you sent, which would
-- pin every count at 1 and mean nothing ever crossed the threshold.
--
-- **SECURITY INVOKER (the default), and that is the gate.** With no insert
-- policy above, a call from any client role fails RLS and writes nothing; the
-- service role the API holds bypasses RLS and writes. Making this SECURITY
-- DEFINER would hand every authenticated client the ability to forge its own
-- taste profile, which is exactly what the missing insert policy is there to
-- prevent — the function would simply route around it.
--
-- `p_profile_id` is therefore safe as a parameter here (unlike the RPCs in
-- 20260815000004, which take `auth.uid()` precisely because a caller can change
-- a parameter): the only caller that can get past RLS is the service role, which
-- resolved the id from a verified token one hop earlier.

create or replace function public.record_taste_signal(
    p_profile_id uuid,
    p_kind text,
    p_value text
)
    returns void
    language sql
as
$function$
insert into profile_taste_signals (profile_id, kind, value)
values (p_profile_id, p_kind, p_value)
on conflict (profile_id, kind, value)
    do update set occurrences  = profile_taste_signals.occurrences + 1,
                  last_seen_at = now();
$function$;

comment on function public.record_taste_signal(uuid, text, text) is
    'Record one revealed preference, incrementing its count if already seen. SECURITY INVOKER: writable only by the service role, since no insert policy grants it to anyone else.';
