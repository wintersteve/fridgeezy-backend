-- Quota periods become a WEEK, on both tiers.
--
-- ## Why the window shrank
--
-- `20260902000002` already made this argument and answered it in the wrong
-- place. Its own note on `first_period` says a monthly cap means "somebody
-- tries the app, spends it, and the app is dead to them for twenty-nine days —
-- they do not convert, they forget", and it fixed that with a bigger FIRST
-- bucket. That only moves the dead month to month two. The window is what was
-- wrong: a week bounds the dead stretch to six days, and it is also the clock
-- the rest of the product already runs on — `/plan` is a seven-day window, the
-- shop is weekly, `plan_slot` is an ordinal inside a week.
--
-- ## Why SUBSCRIBERS are weekly too, which reverses the first reading of this
--
-- The subscriber row is not an allowance, it is an abuse governor — and a
-- monthly bucket is a bad one. 150/month permits all 150 inside an hour on day
-- one: the entire month's spend up front, before a refund or a chargeback can
-- be noticed. A weekly ceiling bounds the RATE, which is the thing actually
-- being protected. It is also what every comparable product does (Claude,
-- ChatGPT and Perplexity all cap on a window far shorter than the billing
-- period), for the same reason.
--
-- **The ceiling is therefore NOT the monthly number divided by four.** The rule
-- from `20260902000002` still holds — a real cook must never meet it — so it is
-- sized against a heavy week (planning seven dinners, a few regenerations, a
-- couple of escalations: ~20 recipes) with a wide margin, landing near
-- monthly ÷ 2.5. That cuts the worst-case burst by about 60% while staying far
-- above anything a person does.
--
-- ## The free tier is not a fraction of the ceiling, and must not become one
--
-- Anchoring free to a share of the governor would make the free tier move every
-- time the anti-abuse threshold is retuned, which is nonsense — they answer
-- different questions. Free is sized against what a real week of cooking looks
-- like; the ceiling is sized against what a script looks like. As it happens
-- that leaves free at roughly a thirtieth of the ceiling, already far more
-- separated than any deliberate ratio would have chosen.

-- Per (bucket, tier), not global: the two tiers were nearly split here — free
-- weekly, ceilings left monthly — and the column is what keeps that decision
-- reversible without another migration.
alter table ai_quota_limits
    add column if not exists period text not null default 'month'
        check (period in ('week', 'month'));

comment on column ai_quota_limits.period is
    'Length of one allowance period for this (bucket, tier). Read by ai_quota_period_start.';

-- How long one period runs. Split out so the start and the end cannot disagree
-- about what a period IS — the same "one definition" rule the status function
-- is built on.
create or replace function public.ai_quota_period_length(p_period text)
    returns interval
    language sql
    immutable
as
$function$
select case p_period when 'week' then interval '7 days' else interval '1 month' end;
$function$;

-- The start of the caller's CURRENT period.
--
-- Still anchored on the signup timestamp rather than on a calendar boundary,
-- and now for a second reason on top of the original one: a Monday reset stacks
-- every user's allowance onto the same morning, which for a weekly window is
-- 4.3x more load concentration than a monthly one had.
--
-- Weekly counts whole 7-day spans since the anchor. `make_interval(weeks => n)`
-- rather than epoch arithmetic on the result, so the reset keeps its wall-clock
-- time across a DST boundary — a period that silently shifted by an hour twice
-- a year would move the reset off the hour somebody learnt it at.
--
-- `greatest(0, ...)` guards a clock that reports a `now` before the anchor:
-- without it the period start lands BEFORE signup, which reads as "not the
-- first period" and quietly hands a brand new account the smaller recurring
-- allowance.
create or replace function public.ai_quota_period_start(p_anchor timestamptz,
                                                        p_period text,
                                                        p_now timestamptz default now())
    returns timestamptz
    language sql
    immutable
as
$function$
select case p_period
           when 'week' then p_anchor + make_interval(weeks =>
               greatest(0, floor(extract(epoch from (p_now - p_anchor)) / 604800)::int))
           else p_anchor + make_interval(months =>
               greatest(0, extract(year from age(p_now, p_anchor))::int * 12
                   + extract(month from age(p_now, p_anchor))::int))
           end;
$function$;

-- The arithmetic, still in ONE place — but the window is now a property of the
-- LIMIT ROW rather than of the caller, so it is computed per bucket instead of
-- once in a CTE. A lateral is what keeps the start computed exactly once per
-- row and reused by the `used` count, the end and the first-period test;
-- three separate calls would be three chances for them to disagree at the
-- instant a period rolls over.
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
                           else 'account' end                                    as tier)
select l.bucket,
       (select count(*)
        from ai_usage_events e
        where e.user_id = c.user_id
          and e.bucket = l.bucket
          and e.created_at >= w.period_start)::int                              as used,
       -- The welcome allowance applies only while the caller is still inside
       -- their very first period, which is exactly when the period start has not
       -- moved off the anchor yet.
       (case when w.period_start = c.anchor then l.first_period else l.per_period end)::int
                                                                                as allowance,
       c.tier,
       w.period_start,
       w.period_start + ai_quota_period_length(l.period)                        as period_end
from caller c
         join ai_quota_limits l on l.tier = c.tier
         cross join lateral (select ai_quota_period_start(c.anchor, l.period) as period_start) w
order by l.bucket;
$function$;

revoke all on function public.ai_quota_status_for(uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_status_for(uuid) to service_role;

-- The two-argument form is gone rather than left as an overload: a caller that
-- forgot the period would silently get monthly windows, and it would be right
-- until the day somebody set a row to 'week'.
drop function if exists public.ai_quota_period_start(timestamptz, timestamptz);

-- Re-seeded for the shorter window. Free is NOT the old monthly figure divided
-- by four — see the header.
update ai_quota_limits set period = 'week';

update ai_quota_limits set first_period = 5, per_period = 2
where bucket = 'recipes' and tier = 'account';
update ai_quota_limits set first_period = 3, per_period = 1
where bucket = 'photos' and tier = 'account';
update ai_quota_limits set first_period = 15, per_period = 5
where bucket = 'questions' and tier = 'account';

update ai_quota_limits set first_period = 60, per_period = 60
where bucket = 'recipes' and tier = 'subscriber';
update ai_quota_limits set first_period = 40, per_period = 40
where bucket = 'photos' and tier = 'subscriber';
update ai_quota_limits set first_period = 350, per_period = 350
where bucket = 'questions' and tier = 'subscriber';
