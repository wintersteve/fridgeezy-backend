------------------------------------------------------------------------------
-- A thin course can be asked a SECOND time
--
-- `asked_courses` answers "have we solicited dishes for this course", and that
-- was the whole of the decision: asked once, never again. It has to be, for the
-- case it was built for — a course the model DECLINED must not be re-asked on
-- every press, because the honest answer is that nothing goes there.
--
-- What it also caught is a course the model endorsed and then under-filled.
-- Between `PAIRINGS_PER_COURSE` and the picker there are three lossy steps —
-- the model names fewer than it was asked for, `persistOrReuseSuggestion`
-- resolves two names onto one row, and the notability gate refuses some — so a
-- course asked for six dishes can arrive holding one. The reader then has a
-- "choice" of one dish, and no press could ever improve it.
--
-- So a course may be asked again ONCE, and `topped_up_courses` is what bounds
-- it. Three states rather than two, and each is a different sentence:
--
--   not in asked_courses        — never asked. A press generates.
--   asked, not topped up, thin  — asked once and short. A press tops it up.
--   topped up, or not thin      — done. A press spends nothing.
--
-- The bound is what makes this safe to leave on: a dish with exactly one real
-- pairing costs two calls across its whole life rather than one per press.
--
-- **A DECLINED course is never topped up.** It is absent from `courses`, so it
-- is not thin — it is empty on purpose, and the API tests endorsement before
-- thinness for exactly that reason.
------------------------------------------------------------------------------

alter table dish_pairing_sets
    add column if not exists topped_up_courses text[] not null default '{}'::text[];

comment on column dish_pairing_sets.topped_up_courses is
    'Courses that have had their one extra generation. A course in here is finished whatever it holds — see 20260916000004.';

do
$$
begin
    if not exists (select 1
                   from pg_constraint
                   where conname = 'dish_pairing_sets_topped_up_bounded') then
        alter table dish_pairing_sets
            add constraint dish_pairing_sets_topped_up_bounded
                check (cardinality(topped_up_courses) <= 4);
    end if;
end
$$;

comment on table dish_pairing_sets is
    'One row per main dish: which courses it wants (courses), which we have solicited dishes for (asked_courses), which have had their one top-up (topped_up_courses), and when. A course in asked_courses with no dish_pairings under it means "we asked and found nothing" — see 20260916000001.';

------------------------------------------------------------------------------
-- `record_dish_pairings` learns the third mode
--
-- `p_topped_up` does two jobs, and they are the same fact read twice:
--
-- 1. It RECORDS the attempt, so the course cannot be asked a third time.
-- 2. It makes the write APPEND for that course instead of replacing it.
--
-- The second is the half that would be a bug if it were missed. A merge clears
-- the courses it is about before inserting — right for a targeted call filling
-- a course that holds nothing, and catastrophic for a top-up, which would
-- delete the one dish the course had and insert only what the second call
-- produced. A course could come back from a top-up with FEWER dishes than it
-- started with.
--
-- Deriving it from `p_topped_up` rather than taking a `p_append` flag keeps the
-- two in step by construction: a call that appends is exactly a call that is
-- topping up, and a seventh boolean nobody sets correctly is how those come
-- apart.
------------------------------------------------------------------------------

-- Signature changed with `p_topped_up`; the old arity is dropped so PostgREST
-- cannot resolve a caller onto a copy that knows nothing about the third state.
drop function if exists public.record_dish_pairings(uuid, text[], jsonb, text, text[], boolean);

create or replace function public.record_dish_pairings(
    p_main_dish_key uuid,
    p_courses       text[],
    p_pairings      jsonb,
    p_model         text default null,
    p_asked         text[] default null,
    p_merge         boolean default false,
    -- Courses this call is TOPPING UP: recorded as spent, and appended to
    -- rather than replaced. See the header.
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
            -- has had its extra call has had it — forgetting that on a later
            -- untargeted run would hand back a third generation for free.
            topped_up_courses = array(
                    select distinct unnest(
                            dish_pairing_sets.topped_up_courses || excluded.topped_up_courses)
                    order by 1),
            generated_at      = excluded.generated_at,
            model             = excluded.model
    returning * into v_set;

    -- A replace clears everything; a merge clears only the courses this call
    -- went and asked about — EXCEPT the ones it is topping up, which it adds
    -- to. See the header for why that exception is load-bearing.
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
    -- top-up idempotent: a second call that names a dish the course already
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
    'Write a dish''s proposed pairings. `p_merge` fills the courses in `p_asked` and leaves the rest; `p_topped_up` marks a course as having had its one extra call and makes that course APPEND rather than replace. See 20260916000004.';

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
