-- A menu is only an example once you could actually cook it.
--
-- `record_menu` (`20260822000002`) files a combination the moment somebody
-- composes it, and a composed course is a SUGGESTION until somebody pays to
-- generate it. So the corpus filled with menus that read as dinners and were
-- proposals: the sheet showed them, retrieval offered them, and taking one up
-- cost an LLM call per course before it could be opened.
--
-- The rule this adds is the obvious one — every course must resolve to a real
-- recipe — and the interesting part is WHERE it lives.
--
-- ## A visibility rule, not a write rule
--
-- The tempting version is to make `record_menu` refuse a combination containing
-- suggestions. It cannot: `save_menu` is `record_menu` plus a reference, and
-- favouriting a meal you have just composed is exactly the case where the
-- courses are not generated yet. The Saved tab has always drawn un-generated
-- courses — that is what its "NEW" plates, the pending shopping-list queue and
-- `useGeneratedCourseSync` are all for — so refusing the write would take a
-- working feature away to fix a different one.
--
-- Kept as a read rule, it also HEALS ITSELF. `menu_courses.dish_key` is
-- immutable and `menu_courses_resolved` follows it to whatever recipe the dish
-- was promoted into, so a menu joins the showcase the moment its last course is
-- generated — by anybody, anywhere in the product, with nothing rewritten and
-- no backfill. That is the property `dish_key` was introduced for
-- (`20260821000001`), used from the other end.
--
-- ## The signature has to change
--
-- "Every course resolves" is a question about the COURSES, so the predicate
-- needs the menu id and no longer fits two denormalised columns. The cheap
-- column tests stay in front of the subquery.
--
-- Safe to make this a subquery, and worth saying why: `menu_is_publishable` is
-- the CURATION rule, called only by the three discovery reads. RLS uses
-- `menu_is_visible`, which stays a scalar over a stored column — so there is no
-- policy on `menus` reading `menu_courses`, and therefore none of the `42P17`
-- recursion that shaped `20260821000001`.
--
-- ## What it also changes, deliberately
--
-- `menu_pairings_for_recipe` shares this predicate, so compose retrieval now
-- offers pairings only out of cookable menus. That is the same rule read from
-- the other side: a pairing is evidence of a dinner somebody could sit down to,
-- not of one that still owes four generations.

create or replace function public.menu_is_publishable(
    p_menu_id           uuid,
    p_owner_profile_id  uuid,
    p_course_count      integer
)
    returns boolean
    language sql
    stable
as
$function$
select p_owner_profile_id is null
    and p_course_count > 1
    -- A course is unresolved exactly when it was saved as a suggestion AND
    -- nothing has since been promoted from it. Mirrors the resolution in
    -- `menu_courses_resolved`, so the sheet cannot show a menu whose courses it
    -- would then draw as un-openable.
    and not exists (select 1
                    from menu_courses mc
                    where mc.menu_id = p_menu_id
                      and not mc.is_recipe
                      and not exists (select 1
                                      from recipes r
                                      where r.source_suggestion_id = mc.dish_key));
$function$;

comment on function public.menu_is_publishable(uuid, uuid, integer) is
    'Is this menu worth showing as an example: shared corpus, more than one dish, and every course generated. CURATION, not privacy — privacy is menu_is_visible and is enforced by RLS.';

grant execute on function public.menu_is_publishable(uuid, uuid, integer) to anon, authenticated;

------------------------------------------------------------------------------
-- The three callers
------------------------------------------------------------------------------

create or replace function community_menus_for_recipe(
    p_recipe_id uuid,
    p_limit     integer default 5
)
    returns table
            (
                menu_id     uuid,
                menu_title  text,
                saved_count integer,
                courses     jsonb
            )
    language sql
    stable
as
$$
with target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key)
select m.id,
       m.name,
       m.saved_count,
       menu_courses_resolved(m.id)
from menus m
where exists (select 1
              from menu_courses mc,
                   target t
              where mc.menu_id = m.id
                and mc.dish_key = t.dish_key)
  and menu_is_publishable(m.id, m.owner_profile_id, m.course_count)
  and not exists (select 1
                  from saved_menus sm
                  where sm.menu_id = m.id
                    and sm.profile_id = current_profile_id())
order by m.saved_count desc, m.name
limit greatest(p_limit, 0);
$$;

create or replace function recent_community_menus(p_limit integer default 6)
    returns table
            (
                menu_id        uuid,
                main_recipe_id uuid,
                main_name      text,
                menu_title     text,
                courses        jsonb
            )
    language sql
    stable
as
$$
with candidate as (select m.id,
                          m.name,
                          m.main_recipe_id,
                          m.created_at,
                          row_number() over (
                              partition by m.main_recipe_id
                              order by m.saved_count desc, m.created_at desc
                              ) as per_dish
                   from menus m
                   where menu_is_publishable(m.id, m.owner_profile_id, m.course_count)
                     and not exists (select 1
                                     from saved_menus sm
                                     where sm.menu_id = m.id
                                       and sm.profile_id = current_profile_id()))
select cd.id,
       cd.main_recipe_id,
       r.name,
       cd.name,
       menu_courses_resolved(cd.id)
from candidate cd
         join recipes r on r.id = cd.main_recipe_id
where cd.per_dish = 1
order by cd.created_at desc
limit greatest(p_limit, 0);
$$;

-- Only the one predicate line differs from `20260822000002`; the rest is
-- reproduced so the function stays readable in one file.
create or replace function public.menu_pairings_for_recipe(
    p_recipe_id     uuid,
    p_course_types  text[],
    p_per_course    integer default 3,
    p_exclude_names text[] default '{}'::text[],
    p_exclude_keys  uuid[] default '{}'::uuid[],
    p_blacklist     uuid[] default '{}'::uuid[],
    p_dietary       text[] default '{}'::text[],
    p_difficulty    text default null
)
    returns table
            (
                course_type        text,
                pair_rank          integer,
                dish_key           uuid,
                is_recipe          boolean,
                dish_id            uuid,
                name               text,
                name_en            text,
                description        text,
                short_description  text,
                difficulty         text,
                total_time_minutes integer,
                image              text,
                ingredients        jsonb,
                tags               jsonb,
                menu_ids           uuid[],
                pair_saves         integer
            )
    language sql
    stable
as
$function$
with wanted as (select distinct lower(btrim(c)) as course_type
                from unnest(p_course_types) c
                where btrim(c) <> ''),

     excluded as (select distinct lower(btrim(n)) as name
                  from unnest(p_exclude_names) n
                  where btrim(n) <> ''),

     diets as (select distinct t.id                              as tag_id,
                               t.canonical_id,
                               (dr.diet_canonical_id is not null) as is_derived
               from unnest(p_dietary) d
                        join tags t
                             on t.type = 'dietary'
                                 and lower(btrim(t.name)) = lower(btrim(d))
                        left join dietary_rules dr on dr.diet_canonical_id = t.canonical_id
               where btrim(d) <> ''),

     diet_tags as (select s.root_id, s.tag_id
                   from tag_subtree(array(select tag_id from diets where not is_derived)) s),

     target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key),

     source_menu as (select m.id,
                            m.saved_count,
                            (m.main_recipe_id = p_recipe_id) as built_around
                     from menus m
                     where menu_is_publishable(m.id, m.owner_profile_id, m.course_count)
                       and exists (select 1
                                   from menu_courses mc,
                                        target t
                                   where mc.menu_id = m.id
                                     and mc.dish_key = t.dish_key)),

     partner as (select mc.dish_key                  as course_key,
                        lower(btrim(mc.course_type)) as course_type,
                        sm.id                        as menu_id,
                        sm.saved_count,
                        sm.built_around
                 from source_menu sm
                          join menu_courses mc on mc.menu_id = sm.id
                          join wanted w on w.course_type = lower(btrim(mc.course_type))
                          cross join target t
                 where mc.dish_key <> t.dish_key
                   and not (mc.dish_key = any (p_exclude_keys))),

     dish as (select k.course_key,
                     fam.id                   as recipe_id,
                     fam.source_suggestion_id as recipe_dish_key,
                     s.id                     as suggestion_id
              from (select distinct course_key from partner) k
                       left join lateral (
                  select b.id, b.source_suggestion_id
                  from recipes r
                           join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                  where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                    and b.created_by is null
                  order by (r.id = k.course_key) desc, b.id
                  limit 1) fam on true
                       left join recipe_suggestions s
                                 on fam.id is null and s.id = k.course_key),

     candidate as (select d.course_key,
                          (d.recipe_id is not null)                                 as is_recipe,
                          coalesce(d.recipe_id, d.suggestion_id)                    as dish_id,
                          coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                          coalesce(r.name, s.name)                                  as name,
                          coalesce(r.name_en, s.name_en)                            as name_en,
                          coalesce(r.description, s.description)                    as description,
                          r.short_description,
                          coalesce(r.difficulty, s.difficulty)::text                as difficulty,
                          coalesce(r.total_time_minutes, s.total_time_minutes)      as total_time_minutes,
                          r.image
                   from dish d
                            left join recipes r on r.id = d.recipe_id
                            left join recipe_suggestions s on s.id = d.suggestion_id
                   where coalesce(d.recipe_id, d.suggestion_id) is not null),

     keep as (select c.*
              from candidate c
              where not exists (select 1
                                from excluded e
                                where e.name in (lower(btrim(c.name)),
                                                 lower(btrim(coalesce(c.name_en, '')))))

                and (coalesce(array_length(p_blacklist, 1), 0) = 0
                  or (c.is_recipe and not exists (select 1
                                                  from recipe_ingredients ri
                                                  where ri.recipe_id = c.dish_id
                                                    and ri.ingredient_id = any (p_blacklist)))
                  or (not c.is_recipe and not exists (select 1
                                                      from recipe_suggestion_ingredients rsi
                                                      where rsi.recipe_suggestion_id = c.dish_id
                                                        and rsi.ingredient_id = any (p_blacklist))))

                and not exists (select 1
                                from diets dt
                                where not (case
                                               when dt.is_derived
                                                   then (c.is_recipe and exists (select 1
                                                                                 from recipe_dietary rd
                                                                                 where rd.recipe_id = c.dish_id
                                                                                   and rd.diet_canonical_id = dt.canonical_id))
                                                       or (not c.is_recipe and exists (select 1
                                                                                       from recipe_suggestion_dietary rsd
                                                                                       where rsd.recipe_suggestion_id = c.dish_id
                                                                                         and rsd.diet_canonical_id = dt.canonical_id))
                                               else (c.is_recipe and exists (select 1
                                                                             from diet_tags s
                                                                                      join recipe_tags rt
                                                                                           on rt.recipe_id = c.dish_id
                                                                                               and rt.tag_id = s.tag_id
                                                                             where s.root_id = dt.tag_id))
                                                   or (not c.is_recipe and exists (select 1
                                                                                   from diet_tags s
                                                                                            join recipe_suggestion_tags rst
                                                                                                 on rst.recipe_suggestion_id = c.dish_id
                                                                                                     and rst.tag_id = s.tag_id
                                                                                   where s.root_id = dt.tag_id))
                    end))),

     ranked as (select p.course_type,
                       k.dish_key,
                       k.is_recipe,
                       k.dish_id,
                       k.name,
                       k.name_en,
                       k.description,
                       k.short_description,
                       k.difficulty,
                       k.total_time_minutes,
                       k.image,
                       array_agg(distinct p.menu_id) as menu_ids,
                       sum(p.saved_count)::integer   as pair_saves,
                       row_number() over (
                           partition by p.course_type
                           order by bool_or(p.built_around) desc,
                                    sum(p.saved_count) desc,
                                    count(distinct p.menu_id) desc,
                                    difficulty_preference_rank(k.difficulty, p_difficulty),
                                    k.name
                           )::integer                as pair_rank
                from keep k
                         join partner p on p.course_key = k.course_key
                group by p.course_type, k.dish_key, k.is_recipe, k.dish_id, k.name,
                         k.name_en, k.description, k.short_description, k.difficulty,
                         k.total_time_minutes, k.image)

select rk.course_type,
       rk.pair_rank,
       rk.dish_key,
       rk.is_recipe,
       rk.dish_id,
       rk.name,
       rk.name_en,
       coalesce(rk.description, ''),
       rk.short_description,
       rk.difficulty,
       rk.total_time_minutes,
       rk.image,
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                     from recipe_ingredients ri
                              join ingredients i on i.id = ri.ingredient_id
                     where ri.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                 from recipe_suggestion_ingredients rsi
                          join ingredients i on i.id = rsi.ingredient_id
                 where rsi.recipe_suggestion_id = rk.dish_id) end,
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                     from recipe_tags rt
                              join tags t on t.id = rt.tag_id
                     where rt.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                 from recipe_suggestion_tags rst
                          join tags t on t.id = rst.tag_id
                 where rst.recipe_suggestion_id = rk.dish_id) end,
       rk.menu_ids,
       rk.pair_saves
from ranked rk
where rk.pair_rank <= greatest(p_per_course, 1);
$function$;

-- The two-argument form has no callers left. Dropped so a future one cannot
-- pick it up and quietly skip the generated-courses test.
drop function if exists public.menu_is_publishable(uuid, integer);

do
$$
declare
    v_count integer;
begin
    select count(*) into v_count from pg_proc where proname = 'menu_is_publishable';
    if v_count <> 1 then
        raise exception 'expected exactly one menu_is_publishable, found %', v_count;
    end if;
end
$$;

notify pgrst, 'reload schema';
