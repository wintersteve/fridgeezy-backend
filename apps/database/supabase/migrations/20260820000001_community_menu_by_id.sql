-- One composed menu, by id, so a tile can open the MENU rather than the dish.
--
-- The home strip used to navigate to the main recipe and present the menus
-- sheet on arrival, which put a recipe screen between the tap and the thing
-- tapped. A menu somebody else composed has no `menus` row the caller may read
-- — RLS is own-profile — so it needs a definer read of its own, keyed on the id
-- the strip already has in hand.
--
-- The id is safe to hand out: it is an opaque uuid, this function applies the
-- same `menu_is_publishable` rule as every other reader, and it returns no
-- profile.

-- `recent_community_menus` has to carry the id now, so the tile has something
-- to navigate to.
drop function if exists recent_community_menus(integer);

create function recent_community_menus(p_limit integer default 6)
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
    security definer
    set search_path = public
as
$$
with caller as (select id from profiles where user_id = auth.uid()),
     candidate as (select m.id,
                          m.name,
                          m.main_recipe_id,
                          m.created_at,
                          row_number() over (
                              partition by m.main_recipe_id
                              order by m.created_at desc
                              ) as per_dish
                   from menus m
                   where not exists (select 1 from caller c where c.id = m.profile_id)
                     and menu_is_publishable(m.id)
                     and exists (select 1
                                 from recipes r
                                 where r.id = m.main_recipe_id
                                   and r.created_by is null))
select cd.id,
       cd.main_recipe_id,
       r.name,
       cd.name,
       (select jsonb_agg(jsonb_build_object(
                                 'recipeId', mc.recipe_id,
                                 'isRecipe', mc.is_recipe,
                                 'courseType', mc.course_type,
                                 'name', mc.name,
                                 'image', mc.image
                             ) order by mc.position)
        from menu_courses mc
        where mc.menu_id = cd.id)
from candidate cd
         join recipes r on r.id = cd.main_recipe_id
where cd.per_dish = 1
order by cd.created_at desc
limit greatest(p_limit, 0);
$$;

revoke all on function recent_community_menus(integer) from public;
grant execute on function recent_community_menus(integer) to anon, authenticated;

create or replace function community_menu(p_menu_id uuid)
    returns table
            (
                menu_title     text,
                main_recipe_id uuid,
                main_name      text,
                profile_count  bigint,
                courses        jsonb
            )
    language sql
    stable
    security definer
    set search_path = public
as
$$
with target as (select m.id, m.name, m.main_recipe_id
                from menus m
                where m.id = p_menu_id
                  and menu_is_publishable(m.id)
                  -- The screen links to every course, so the main must be
                  -- catalogue. Deliberately NOT excluding the caller's own: a
                  -- link that resolves for everyone except its owner is a dead
                  -- end nobody can explain, and their own menu read back
                  -- read-only is harmless.
                  and exists (select 1
                              from recipes r
                              where r.id = m.main_recipe_id
                                and r.created_by is null)),
     dish_set as (select array_agg(mc.recipe_id order by mc.recipe_id) as ids
                  from menu_courses mc
                  where mc.menu_id = (select id from target))
select t.name,
       t.main_recipe_id,
       r.name,
       -- How many people composed this same set of dishes, counted the way
       -- `community_menus_for_recipe` counts it: by the dishes, not the title,
       -- which the model writes differently every time.
       (select count(distinct m2.profile_id)
        from menus m2
        where m2.main_recipe_id = t.main_recipe_id
          and (select array_agg(mc.recipe_id order by mc.recipe_id)
               from menu_courses mc
               where mc.menu_id = m2.id) = (select ids from dish_set)),
       (select jsonb_agg(jsonb_build_object(
                                 'recipeId', mc.recipe_id,
                                 'isRecipe', mc.is_recipe,
                                 'courseType', mc.course_type,
                                 'name', mc.name,
                                 'image', mc.image
                             ) order by mc.position)
        from menu_courses mc
        where mc.menu_id = t.id)
from target t
         join recipes r on r.id = t.main_recipe_id;
$$;

revoke all on function community_menu(uuid) from public;
grant execute on function community_menu(uuid) to anon, authenticated;

comment on function community_menu(uuid) is
    'One composed menu by id, for the screen a home-feed tile opens. SECURITY DEFINER over own-profile tables; returns no profile and refuses anything `menu_is_publishable` refuses.';
