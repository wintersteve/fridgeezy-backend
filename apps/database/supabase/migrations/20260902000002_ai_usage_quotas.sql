-- Metered AI usage: what a free account may spend before the paywall.
--
-- Until now the product's rule was "if a model runs, it is paid", enforced by
-- `requireEntitlement` on every AI mount. That is enforceable and it converts
-- badly, because nobody who has not paid can experience a single model call —
-- the paywall is a claim rather than a demonstration. A quota turns the same
-- gate into "here is your recipe, four left", and moves the ask onto somebody
-- who has already had value out of us.
--
-- Three buckets, not one per route. Eight counters is a spreadsheet; these are
-- three nouns a cook recognises, and the client says them in those words:
--
--   recipes   — anything that WRITES a recipe: promote, resolve, modify,
--               escalate, adapt, compose, generate
--   photos    — anything that READS an image: fridge extract, recipe import
--   questions — anything that ANSWERS: chat, recipe chat, substitutes
--
-- `/suggestions/generate` is deliberately NOT metered and stays subscriber-only.
-- The feed generates dish ideas ambiently as the reader scrolls, so a reader
-- does not experience it as an action — "you are out" would point at nothing.
-- The catalogue already holds hundreds of stored suggestions that are free to
-- read, which is what makes the split work: the IDEAS are free, and what costs
-- money is turning one into a recipe.

create type ai_quota_bucket as enum ('recipes', 'photos', 'questions');

-- One row per CHARGED model call. An event log rather than a counter column,
-- for three reasons: it is auditable when somebody disputes a count, the window
-- can be redefined later without a backfill, and there is no read-modify-write
-- to race on the request path.
create table if not exists ai_usage_events
(
    -- `auth.users`, not `profiles`, to match `profile_entitlements` — the write
    -- path already holds the auth user id from `requireSupabaseUser` and would
    -- otherwise pay for a profiles lookup on every metered request.
    user_id    uuid                     not null references auth.users (id) on delete cascade,
    bucket     ai_quota_bucket          not null,
    -- Which endpoint spent it. Not used by the quota arithmetic; it is what makes
    -- an unexpected count explicable without reading application logs.
    route      text                     not null,
    id         uuid primary key                  default gen_random_uuid(),
    created_at timestamp with time zone not null default now()
);

-- The exact shape `ai_quota_status` counts on: everything for one user and
-- bucket since a period start.
create index if not exists idx_ai_usage_events_user_bucket_created
    on ai_usage_events using btree (user_id, bucket, created_at desc);

alter table ai_usage_events enable row level security;

-- Readable by its owner, writable by nobody but the service role — the same
-- posture as `profile_entitlements`, and for the same reason. A client that
-- could delete its own usage rows could reset its own quota, and one that could
-- insert them could spend somebody else's.
create policy users_read_own_ai_usage on ai_usage_events for select using ((auth.uid() = user_id));

-- What each tier may spend. A TABLE rather than constants in the API because
-- these are the numbers most likely to be wrong: the honest answer to "how many
-- free recipes" only comes from watching real conversion, and tuning it must not
-- need a deploy.
create table if not exists ai_quota_limits
(
    bucket       ai_quota_bucket not null,
    -- Mirrors `MountTier` in the API. `subscriber` means an active entitlement
    -- by `entitlement_is_active`; `account` is everyone else with a session.
    tier         text            not null check (tier in ('account', 'subscriber')),
    -- The allowance in a user's FIRST period, which is the welcome allowance:
    -- deliberately larger than the recurring one, because the first month is
    -- what has to demonstrate the product. A monthly cap on its own means
    -- somebody tries the app, spends it, and the app is dead to them for
    -- twenty-nine days — they do not convert, they forget.
    first_period integer         not null,
    -- Every period after that. Small on the free tier on purpose: it keeps the
    -- app alive and keeps re-presenting the same wall at the moment of wanting.
    per_period   integer         not null,
    primary key (bucket, tier)
);

alter table ai_quota_limits enable row level security;

-- World-readable to a signed-in caller: the client shows "3 of 5" in Settings,
-- and a limit nobody can read is a limit nobody can be warned about. Writes are
-- service-role only, by omission.
create policy authenticated_read_quota_limits on ai_quota_limits for select to authenticated using (true);

insert into ai_quota_limits (bucket, tier, first_period, per_period)
values
    -- A cook can turn five suggestions into real recipes — enough to cook from
    -- the app three or four times and see what a generated recipe actually is,
    -- steps, timings and picture — then three a month keeps them coming back.
    ('recipes', 'account', 5, 3),
    ('photos', 'account', 5, 2),
    ('questions', 'account', 20, 10),
    -- Subscribers get a fair-use ceiling, not a quota. It exists so one scripted
    -- account cannot run up an unbounded bill; a real cook does perhaps twenty
    -- recipes a month and must never see it. The client does not draw a ceiling
    -- for this tier — see `ai_quota_status.tier`.
    ('recipes', 'subscriber', 150, 150),
    ('photos', 'subscriber', 100, 100),
    ('questions', 'subscriber', 1000, 1000)
on conflict (bucket, tier) do nothing;

-- The start of the caller's current allowance period.
--
-- The SIGNUP ANNIVERSARY, not the calendar month. A calendar reset hands
-- somebody who joins on the 28th three days of allowance and then tells them
-- they are out, which reads as a bug; it also stacks every user's renewal onto
-- the first of the month.
--
-- `age()` gives whole years/months/days, so the month count it yields is exactly
-- the number of complete periods elapsed — and `+ interval` clamps a 31st to the
-- end of a short month, which is the behaviour wanted at the edges.
create or replace function public.ai_quota_period_start(p_anchor timestamptz, p_now timestamptz default now())
    returns timestamptz
    language sql
    immutable
as
$function$
select p_anchor + make_interval(months =>
                                (extract(year from age(p_now, p_anchor))::int * 12
                                    + extract(month from age(p_now, p_anchor))::int));
$function$;

-- The arithmetic, in ONE place.
--
-- Both readers go through this: the client, for the rows it draws in Settings,
-- and the API's `requireQuota` middleware, for the decision it makes on every
-- metered request. Two implementations of "how many are left" that disagree is
-- the worst failure available here — a client promising two more recipes while
-- the server answers 402 — and it is exactly the trap
-- `entitlement_is_active` / `isEntitlementActive` documents living with. There
-- is no second copy to keep in step because there is no second copy.
--
-- `security definer` so it can read `ai_usage_events` and `ai_quota_limits`
-- without either needing a broader policy. It TAKES a user id, so it is granted
-- to the service role only; `ai_quota_status()` below is the caller-scoped
-- wrapper that authenticated clients get.
create or replace function public.ai_quota_status_for(p_user_id uuid)
    returns table
            (
                bucket       ai_quota_bucket,
                used         integer,
                allowance    integer,
                tier         text,
                period_start timestamp with time zone,
                period_end   timestamp with time zone
            )
    language sql
    stable
    security definer
    set search_path = public
as
$function$
with caller as (select p_user_id                                                 as user_id,
                       -- A signed-in user always has a profile (the auth.users
                       -- trigger writes one). `now()` is the degenerate fallback
                       -- rather than null, which would make the whole select
                       -- return no rows and read as "unlimited" to a caller that
                       -- only checks for an exhausted bucket.
                       coalesce((select p.created_at from profiles p where p.user_id = p_user_id),
                                now())                                           as anchor,
                       case
                           when entitlement_is_active(p_user_id) then 'subscriber'
                           else 'account' end                                    as tier),
     window_ as (select c.user_id,
                        c.tier,
                        ai_quota_period_start(c.anchor)                       as period_start,
                        ai_quota_period_start(c.anchor) + interval '1 month'  as period_end,
                        -- Whether this is the caller's first period, which is
                        -- what selects the welcome allowance.
                        ai_quota_period_start(c.anchor) = c.anchor            as is_first
                 from caller c)
select l.bucket,
       (select count(*)
        from ai_usage_events e
        where e.user_id = w.user_id
          and e.bucket = l.bucket
          and e.created_at >= w.period_start)::int                              as used,
       (case when w.is_first then l.first_period else l.per_period end)::int    as allowance,
       w.tier,
       w.period_start,
       w.period_end
from window_ w
         join ai_quota_limits l on l.tier = w.tier
order by l.bucket;
$function$;

-- `anon` and `authenticated` are revoked BY NAME, not just `public`.
--
-- Supabase's base setup carries
-- `alter default privileges in schema public grant all on functions to anon,
-- authenticated, service_role`, so every new function is granted to those roles
-- DIRECTLY. Revoking from `public` does not touch a direct grant — this was
-- verified the wrong way round first: `revoke all ... from public` alone left
-- the shipped anon key able to read any user's quota by id.
revoke all on function public.ai_quota_status_for(uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_status_for(uuid) to service_role;

-- What the app draws in Settings, scoped to whoever is asking.
--
-- Takes no parameter deliberately: a `p_user_id` an authenticated client could
-- pass is a user id it could pass somebody ELSE'S.
create or replace function public.ai_quota_status()
    returns table
            (
                bucket       ai_quota_bucket,
                used         integer,
                allowance    integer,
                tier         text,
                period_start timestamp with time zone,
                period_end   timestamp with time zone
            )
    language sql
    stable
    security definer
    set search_path = public
as
$function$
select * from ai_quota_status_for(auth.uid());
$function$;

-- Same revoke-by-name, then granted back to `authenticated` only: a signed-out
-- caller has no `auth.uid()` and would read the anonymous degenerate row.
revoke all on function public.ai_quota_status() from public, anon, authenticated;
grant execute on function public.ai_quota_status() to authenticated;
