-- A dish belongs to every menu it is IN, not just the ones it heads.
--
-- `community_menus_for_recipe` matched `m.main_recipe_id = p_recipe_id`, so the
-- badge only ever appeared on the dish a menu was built around. Braised Red
-- Cabbage is a side in two menus and heads none: Roast Goose showed two menus,
-- one of them containing the cabbage, and the cabbage's own screen showed
-- nothing. The relationship is real in both directions and was only readable in
-- one.
--
-- That was defensible while `menus` was per-profile — a menu was your private
-- note about a main course — and stopped being defensible the moment menus
-- became shared catalogue objects (`20260821000001`). A menu is a set of
-- dishes; every dish in it is a way in.
--
-- ## Matched on `dish_key`, not on `recipe_id`
--
-- The course may still point at the suggestion its dish was promoted from,
-- while the reader is looking at the recipe. Matching the raw pointer would
-- show the badge on some dishes and not others depending on when the menu
-- happened to be composed — exactly the asymmetry this migration is removing.
-- `dish_key` is the normalised identity and both compositions agree on it.

create index if not exists idx_menu_courses_dish_key
    on menu_courses using btree (dish_key);

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
    -- The dish this recipe IS, in the terms `menu_courses` records. Falls back
    -- to the id itself so a suggestion id works here too.
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
  and m.saved_count > 0
  and not exists (select 1
                  from saved_menus sm
                  where sm.menu_id = m.id
                    and sm.profile_id = current_profile_id())
-- Menus built AROUND this dish first: on the goose's screen, a goose dinner is
-- a better answer than a stew that happens to serve goose alongside it. Then
-- the most-kept, then stable by name.
order by (m.main_recipe_id = p_recipe_id) desc, m.saved_count desc, m.name
limit greatest(p_limit, 0);
$$;

comment on function community_menus_for_recipe(uuid, integer) is
    'Menus other profiles composed CONTAINING a recipe — as any course, not only as the main. Menus built around it rank first. SECURITY INVOKER.';

-- Same jsonb, one copy. `menu_courses_resolved` also gives the strip's tiles the
-- resolved pointer, so a promoted course draws its recipe's art rather than the
-- suggestion's blank.
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
                     and m.saved_count > 0
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

notify pgrst, 'reload schema';
