-- Charged-usage events are kept for 90 days, and then they are exhaust.
--
-- `ai_usage_events` (`20260902000002`) writes ONE ROW PER CHARGED MODEL CALL,
-- has no uniqueness, and nothing has ever deleted one. It is the fastest-growing
-- per-user table in the schema and the only one that grows purely as a side
-- effect of the product working: at the subscriber ceilings in
-- `ai_quota_limits` — 60 recipes + 40 photos + 350 questions a week — that is
-- up to 450 rows a week, so ~23,000 a year for one heavy subscriber (a free
-- account is 8 a week, ~400 a year).
--
-- **Nothing reads a row older than the current period.** `ai_quota_status` is
-- the only reader and it counts `created_at >= period_start`, which is one
-- WEEK (`20260904000005`). The welcome allowance is decided by comparing that
-- period start against the profile's own `created_at` anchor, not by looking at
-- events, so no prune can change what anybody is allowed.
--
-- So why 90 days rather than the seven the arithmetic needs: the table's own
-- header keeps the events as an audit — "auditable when somebody disputes a
-- count" — and a dispute arrives weeks after the charge, not days. Ninety days
-- is about thirteen periods of evidence behind every live question, and still
-- cuts a heavy subscriber's footprint by roughly three quarters. It is a
-- retention policy, which is why it is a number in one place with this note
-- next to it.
--
-- ## A scheduled sweep, NOT a trigger
--
-- The obvious cheap version — delete the old rows on insert, the way the view
-- history and the prompt log prune themselves — is wrong here, and the table's
-- own header says why: an event log was chosen over a counter column partly
-- because "there is no read-modify-write to race on the request path". A
-- delete-on-insert puts one straight back, on the hottest gated path in the
-- app, to collect rows whose age has nothing to do with the request that
-- triggered it. So this is a function on a daily job, and the insert path is
-- untouched.
--
-- `pg_cron` has been enabled since `20260801000001` and this is the first job
-- scheduled on it. That is not an accident either: the other maintenance
-- function, `delete_orphan_generated_recipes`, is deliberately UNSCHEDULED
-- because it deletes RECIPES and cannot yet tell a draft from a catalogue
-- entry. This one deletes rows that only ever counted toward a window which has
-- closed, so it carries none of that hazard.

create or replace function public.delete_expired_ai_usage_events(p_keep_days integer default 90)
    returns integer
    language plpgsql
as
$function$
declare
    v_deleted integer;
begin
    with removed as (
        delete
            from ai_usage_events e
                where e.created_at < now() - make_interval(days => p_keep_days)
                returning e.id)
    select count(*) into v_deleted from removed;

    return v_deleted;
end;
$function$;

comment on function public.delete_expired_ai_usage_events(integer) is
    'Deletes charged-usage events older than p_keep_days (default 90). Nothing reads past the current quota period; the extra weeks are the audit trail. Scheduled daily — never called from the request path.';

-- Daily, at a quiet hour in UTC. `cron.schedule` upserts on the job NAME in
-- pg_cron 1.4+, so re-running this migration re-points the job rather than
-- raising on a duplicate; the unschedule below covers an older server and makes
-- the intent explicit either way.
--
-- One day's rows per run once it starts biting — the table was created on
-- 2026-09-02, so nothing in it is 90 days old yet and the first sweep deletes
-- nothing. There is deliberately no backfill statement: there is nothing to
-- back-fill, and a `delete` with no rows to find is not worth a migration line.
select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-expired-ai-usage-events';

select cron.schedule(
               'delete-expired-ai-usage-events',
               '20 3 * * *',
               $$select public.delete_expired_ai_usage_events();$$
       );

notify pgrst, 'reload schema';
