-- Composing a menu records it. Favouriting it is a separate act.
--
-- `save_menu` has been the only writer since `20260821000002`, so a combination
-- existed only once somebody tapped the heart. Everything else about it was
-- already built — the identity, the corpus, the retrieval that reads it — and
-- the effect was that compose could produce a dinner, show it, and leave no
-- trace of the pairing for anyone else. Two dishes that go together are worth
-- knowing whether or not the person who found that out kept the meal.
--
-- ## Two verbs now, and the split is the point
--
--   record_menu — this combination EXISTS. Writes `menus` + `menu_courses`.
--   save_menu   — and I KEEP it. `record_menu`, then the `saved_menus` row.
--
-- `save_menu` is now literally `record_menu` plus the reference, rather than a
-- second copy of the same find-or-create. A divergence between two copies would
-- mint a menu under one identity from one path and another from the other,
-- which is the failure `menu_course_input` was extracted to prevent one level
-- down.
--
-- ## `saved_count > 0` goes
--
-- The discovery functions required it, on the argument that advertising a menu
-- nobody keeps is the problem. That was true while a menu could only be created
-- BY a save — the count was 1 at birth and 0 only meant "everyone let go". It is
-- false now: a recorded combination starts at 0 and would be invisible from the
-- moment it was written, which is precisely the evidence this migration exists
-- to collect.
--
-- `saved_count` keeps its other job. It still ORDERS both functions, so a
-- combination people actually kept comes first and the limit of 5 the sheet asks
-- for is the top 5 by favourites — unfavourited ones fill the list only when
-- there are not 5 favourited ones to show.

------------------------------------------------------------------------------
-- 1. record_menu — the combination, without the opinion
------------------------------------------------------------------------------

create or replace function public.record_menu(
    p_name           text,
    p_main_recipe_id uuid,
    p_courses        jsonb
)
    returns menus
    language plpgsql
    security definer
    set search_path = public, pg_temp
as
$function$
declare
    v_profile_id uuid := current_profile_id();
    v_owner      uuid;
    v_main_owner uuid;
    v_signature  uuid[];
    v_count      integer;
    v_menu       menus;
begin
    -- Still an authenticated write. Not because the row is attributed — it is
    -- not, deliberately — but because the owner test below needs to know who is
    -- asking, and because an unauthenticated writer into a shared corpus is a
    -- spam surface with no handle on it.
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'record_menu: no profile for the current user';
    end if;

    select array_agg(c.dish_key order by c.dish_key),
           count(*)::integer,
           (array_agg(c.created_by) filter (where c.created_by is not null))[1]
    into v_signature, v_count, v_owner
    from menu_course_input(p_courses) c
    where c.recipe_id is not null;

    if coalesce(v_count, 0) = 0 then
        raise exception using
            errcode = 'check_violation',
            message = 'record_menu: a menu needs at least one course';
    end if;

    select r.created_by into v_main_owner from recipes r where r.id = p_main_recipe_id;

    if not found then
        raise exception using
            errcode = 'no_data_found',
            message = format('record_menu: no recipe %s to build a menu around', p_main_recipe_id);
    end if;

    v_owner := coalesce(v_owner, v_main_owner);

    if v_owner is not null and v_owner <> v_profile_id then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'record_menu: a course belongs to another profile';
    end if;

    insert into menus (name, main_recipe_id, dish_signature, owner_profile_id, course_count)
    values (left(btrim(coalesce(p_name, '')), 120), p_main_recipe_id,
            v_signature, v_owner, v_count)
    on conflict (main_recipe_id, dish_signature) do nothing
    returning * into v_menu;

    if v_menu.id is null then
        -- Somebody already composed this exact set. Their courses stand —
        -- course types, positions and images included — and the caller has not
        -- created anything, they have arrived at what exists. Which is the
        -- whole point of recording: the second person to find a pairing should
        -- land on the first person's row, not beside it.
        select * into v_menu
        from menus
        where main_recipe_id = p_main_recipe_id
          and dish_signature = v_signature;
    else
        insert into menu_courses (menu_id, recipe_id, is_recipe, dish_key, course_type,
                                  position, name, description, difficulty, image)
        select v_menu.id, c.recipe_id, c.is_recipe, c.dish_key, c.course_type,
               c.course_position, c.name, c.description, c.difficulty, c.image
        from menu_course_input(p_courses) c
        where c.recipe_id is not null;
    end if;

    return v_menu;
end;
$function$;

comment on function public.record_menu(text, uuid, jsonb) is
    'Find-or-create a shared menu for a combination, WITHOUT keeping it. What compose calls when a composition settles; `save_menu` is this plus the saved_menus reference — see 20260822000002.';

revoke all on function public.record_menu(text, uuid, jsonb) from public;
grant execute on function public.record_menu(text, uuid, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 2. save_menu becomes record_menu + the reference
------------------------------------------------------------------------------

create or replace function public.save_menu(
    p_name           text,
    p_main_recipe_id uuid,
    p_courses        jsonb
)
    returns menus
    language plpgsql
    security definer
    set search_path = public, pg_temp
as
$function$
declare
    v_profile_id uuid := current_profile_id();
    v_menu       menus;
begin
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'save_menu: no profile for the current user';
    end if;

    -- The combination first, by the one path that creates one. Every check
    -- that used to live here — the course resolution, the owner test, the
    -- identity — is in there, so the two verbs cannot disagree about what a
    -- menu IS.
    v_menu := record_menu(p_name, p_main_recipe_id, p_courses);

    -- Then the opinion. Re-saving the same main with a different set of dishes
    -- repoints `menu_id`, which is the UPDATE arm `sync_menu_saved_count`
    -- exists for; the menu let go of survives at `saved_count` 0 and — since
    -- this migration — is still discoverable, because it is still a real
    -- combination somebody composed.
    insert into saved_menus (profile_id, menu_id, label)
    values (v_profile_id, v_menu.id,
            nullif(left(btrim(coalesce(p_name, '')), 120), ''))
    on conflict (profile_id, main_recipe_id)
        do update set menu_id = excluded.menu_id,
                      label   = excluded.label;

    return v_menu;
end;
$function$;

comment on function public.save_menu(text, uuid, jsonb) is
    'Record a combination and keep it: `record_menu` plus this profile''s saved_menus reference. The only writer of saved_menus — see 20260822000002.';

------------------------------------------------------------------------------
-- 3. The discovery reads stop requiring a save
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
  and menu_is_publishable(m.owner_profile_id, m.course_count)
  and not exists (select 1
                  from saved_menus sm
                  where sm.menu_id = m.id
                    and sm.profile_id = current_profile_id())
-- `saved_count` ORDERS rather than gates, so `p_limit` (5) is the top five by
-- favourites and a combination nobody has kept yet fills a slot only when there
-- are not five favourited ones to show.
order by m.saved_count desc, m.name
limit greatest(p_limit, 0);
$$;

comment on function community_menus_for_recipe(uuid, integer) is
    'Menus other profiles composed CONTAINING a recipe — as any course, not only as the main — most-favourited first. SECURITY INVOKER.';

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
                   where menu_is_publishable(m.owner_profile_id, m.course_count)
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

------------------------------------------------------------------------------
-- 4. Retrieval, likewise
------------------------------------------------------------------------------
--
-- `menu_pairings_for_recipe` gated on the same column for the same reason, and
-- the reason has gone the same way: a pairing is evidence whether or not the
-- person who composed it kept the meal. `sum(saved_count)` still leads the
-- ranking, so kept pairings are still offered first.

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
                     where menu_is_publishable(m.owner_profile_id, m.course_count)
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

notify pgrst, 'reload schema';
