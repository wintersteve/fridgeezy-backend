------------------------------------------------------------------------------
-- A course can be asked again, up to a bound, and the reader can ask
--
-- `20260916000004` gave a thin course ONE extra call and recorded it in
-- `topped_up_courses`. That was the right shape for the thing it was solving —
-- a course that under-filled silently, topped up automatically when somebody
-- next opened it — and it is the wrong shape for a BUTTON.
--
-- The picker now draws "Show me more", and the bound has to survive being
-- pressed on purpose. Two things break if it does not:
--
--   * `topped_up_courses` is a SET, so it cannot count. One extra call, ever.
--   * It lives on the SHARED set, keyed on the main dish rather than on the
--     reader. So the one extra call belongs to whoever gets there first, and
--     every reader after them finds the button spent by a stranger who
--     composed around the same main last week. That is a lottery, not a
--     control.
--
-- `generation_attempts` counts instead: course -> how many times this set has
-- gone and asked about it. The API stops offering at `PAIRING_MAX_ATTEMPTS`,
-- and separately stops once the course holds enough dishes to fill the picker
-- (`PAIRING_CANDIDATE_CEILING`, the twin of the client's
-- `MAX_COURSE_CANDIDATES`). Both bounds are needed and they catch different
-- failures:
--
--   holdings  — the course is full. Another call would produce dishes nobody
--               can see, because the read caps what it returns.
--   attempts  — the course is NOT full and the model has nothing more to say.
--               Every call excludes what the course already holds, so a dish
--               with two honest pairings answers the third ask with nothing;
--               without this bound the button is drawn forever and each press
--               charges a reader to rediscover that.
--
-- **`topped_up_courses` STAYS, and its second job is why.** It records which
-- courses a write should APPEND to rather than clear — see `20260916000004`,
-- where that is the half that would delete the one dish a course had. What it
-- no longer does is bound anything; the count does that now.
------------------------------------------------------------------------------

alter table dish_pairing_sets
    add column if not exists generation_attempts jsonb not null default '{}'::jsonb;

comment on column dish_pairing_sets.generation_attempts is
    'Course -> how many times this set has solicited dishes for it. The bound behind the picker''s "show me more"; see 20260922000003.';

do
$$
begin
    if not exists (select 1
                   from pg_constraint
                   where conname = 'dish_pairing_sets_attempts_object') then
        alter table dish_pairing_sets
            add constraint dish_pairing_sets_attempts_object
                check (jsonb_typeof(generation_attempts) = 'object');
    end if;
end
$$;

comment on table dish_pairing_sets is
    'One row per main dish: which courses it wants (courses), which we have solicited dishes for (asked_courses), which must be appended to rather than replaced (topped_up_courses), how many times each has been asked (generation_attempts), and when. A course in asked_courses with no dish_pairings under it means "we asked and found nothing" — see 20260916000001.';

------------------------------------------------------------------------------
-- Backfill: what the old column implies about the new one
--
-- `asked_courses` means the set solicited that course at least once, and
-- `topped_up_courses` means it went back a second time. So every existing row
-- can state its own history exactly, and no dish loses a press it had already
-- earned — nor gains one it had already spent.
--
-- Derived rather than defaulted to `{}`: an empty map reads as "never asked",
-- which would hand a third and fourth call to every dish already in the
-- catalogue.
------------------------------------------------------------------------------

update dish_pairing_sets
set generation_attempts = coalesce((
        select jsonb_object_agg(course,
                                case when course = any (topped_up_courses) then 2 else 1 end)
        from (select distinct unnest(asked_courses) as course) asked
        where asked.course is not null
    ), '{}'::jsonb)
where generation_attempts = '{}'::jsonb
  and cardinality(asked_courses) > 0;

------------------------------------------------------------------------------
-- `record_dish_pairings` counts the attempt
--
-- DERIVED from `p_asked` rather than taken as an eighth parameter, which is the
-- same call `p_topped_up` made for `p_append`: a run that solicited a course IS
-- an attempt on it, so the two cannot come apart, and a parameter nobody
-- remembers to pass is how a bound quietly stops binding.
--
-- It is a second statement rather than a branch of the upsert because it has to
-- ADD to what is already stored, on BOTH paths. `topped_up_courses` is unioned
-- for the same reason and the note there applies verbatim: a replace rewrites
-- what the model thinks and what has been asked, but a call that has been made
-- has been made, and forgetting it on a later untargeted run hands back the
-- whole budget for free. Correlated on the row being updated, so two concurrent
-- generations cannot read the same count and both write back the same +1.
------------------------------------------------------------------------------

create or replace function public.record_dish_pairings(
    p_main_dish_key uuid,
    p_courses       text[],
    p_pairings      jsonb,
    p_model         text default null,
    p_asked         text[] default null,
    p_merge         boolean default false,
    p_topped_up     text[] default '{}'::text[]
)
    returns dish_pairing_sets
    language plpgsql
    security definer
    set search_path = public, pg_temp
as
$function$
declare
    v_set      dish_pairing_sets;
    v_asked    text[] := coalesce(p_asked, p_courses, '{}'::text[]);
    v_topped   text[] := coalesce(p_topped_up, '{}'::text[]);
begin
    if p_main_dish_key is null then
        raise exception using
            errcode = 'null_value_not_allowed',
            message = 'record_dish_pairings: a set needs a dish to be about';
    end if;

    insert into dish_pairing_sets (main_dish_key, courses, asked_courses,
                                   topped_up_courses, generated_at, model)
    values (p_main_dish_key,
            coalesce(p_courses, '{}'::text[]),
            v_asked,
            v_topped,
            now(),
            p_model)
    on conflict (main_dish_key)
        do update set
            -- The model's opinion is set by the untargeted call and never
            -- widened by a targeted one — see the column's own note.
            courses           = case
                                    when p_merge then dish_pairing_sets.courses
                                    else excluded.courses
                                    end,
            asked_courses     = case
                                    when p_merge then array(
                                            select distinct unnest(
                                                    dish_pairing_sets.asked_courses || excluded.asked_courses)
                                            order by 1)
                                    else excluded.asked_courses
                                    end,
            -- UNIONED on both paths, unlike the two above. A replace rewrites
            -- what the model thinks and what has been asked, but a course that
            -- must be appended to still must be — see 20260916000004.
            topped_up_courses = array(
                    select distinct unnest(
                            dish_pairing_sets.topped_up_courses || excluded.topped_up_courses)
                    order by 1),
            generated_at      = excluded.generated_at,
            model             = excluded.model
    returning * into v_set;

    -- One attempt per course this run SOLICITED, added to whatever is stored.
    -- `v_set` is re-read here so the caller is handed the count it just spent:
    -- the API decides whether to offer another press on exactly this, and
    -- answering with the pre-increment row would offer a press that is gone.
    update dish_pairing_sets s
    set generation_attempts = coalesce(s.generation_attempts, '{}'::jsonb) ||
                              coalesce((
                                  select jsonb_object_agg(
                                          asked.course,
                                          coalesce((s.generation_attempts ->> asked.course)::integer, 0) + 1)
                                  from (select distinct unnest(v_asked) as course) asked
                                  where asked.course is not null
                              ), '{}'::jsonb)
    where s.main_dish_key = p_main_dish_key
    returning s.* into v_set;

    -- A replace clears everything; a merge clears only the courses this call
    -- went and asked about — EXCEPT the ones it is topping up, which it adds
    -- to. See 20260916000004 for why that exception is load-bearing.
    if p_merge then
        delete from dish_pairings
        where main_dish_key = p_main_dish_key
          and course_type = any (v_asked)
          and not (course_type = any (v_topped));
    else
        delete from dish_pairings where main_dish_key = p_main_dish_key;
    end if;

    -- `distinct on` rather than a plain insert: the caller assembles this list
    -- from a model's output after dedup has resolved several names onto one
    -- row, so the same dish can legitimately arrive twice under two courses.
    -- The unique constraint would abort the whole write; keeping the
    -- better-ranked copy is the answer the constraint is there to express.
    --
    -- The `not exists` is the merge's other half, and it is what makes a
    -- refill idempotent: a second call that names a dish the course already
    -- holds inserts nothing rather than aborting on the unique constraint.
    insert into dish_pairings (main_dish_key, course_type, dish_key, rank)
    select distinct on (e.dish_key)
           p_main_dish_key,
           e.course_type,
           e.dish_key,
           e.rank
    from jsonb_to_recordset(coalesce(p_pairings, '[]'::jsonb))
             as e(course_type text, dish_key uuid, rank integer)
    where e.dish_key is not null
      and e.course_type is not null
      and e.dish_key <> p_main_dish_key
      and not exists (select 1
                      from dish_pairings existing
                      where existing.main_dish_key = p_main_dish_key
                        and existing.dish_key = e.dish_key)
    order by e.dish_key, e.rank;

    return v_set;
end;
$function$;

comment on function public.record_dish_pairings(uuid, text[], jsonb, text, text[], boolean, text[]) is
    'Write a dish''s proposed pairings. `p_merge` fills the courses in `p_asked` and leaves the rest; `p_topped_up` makes those courses APPEND rather than replace; every course in `p_asked` has its generation_attempts count raised. See 20260916000004 and 20260922000003.';

revoke all on function public.record_dish_pairings(uuid, text[], jsonb, text, text[], boolean, text[]) from public;

------------------------------------------------------------------------------
-- Exactly one of it, so PostgREST cannot pick the wrong arity.
------------------------------------------------------------------------------

do
$$
declare
    v_count integer;
begin
    select count(*)
    into v_count
    from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_dish_pairings';

    if v_count <> 1 then
        raise exception 'expected exactly 1 record_dish_pairings, found %', v_count;
    end if;
end
$$;
