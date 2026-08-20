-- The home strip's tile became a MOSAIC of every course, so the tile now needs
-- every course's picture rather than just the main's.
--
-- `20260819000003` returned only what the tile drew at the time — a name, one
-- image, a count — on the argument that shipping the course list to a strip that
-- would not render it was payload for nobody. That argument held until the tile
-- started rendering it.
--
-- `main_recipe_id` stays: it is what the tap navigates to, and it is not
-- derivable from the courses (the main is `menus.main_recipe_id`, and nothing in
-- a course row says which one it is).

-- Dropped rather than replaced: the return type changes, and `create or
-- replace` refuses that (42P13). Safe here because nothing holds a reference to
-- it — it is called by name over PostgREST.
drop function if exists recent_community_menus(integer);

create function recent_community_menus(p_limit integer default 6)
    returns table
            (
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
                          -- One menu per DISH, so a strip of six shows six
                          -- dishes rather than six ways to serve one.
                          row_number() over (
                              partition by m.main_recipe_id
                              order by m.created_at desc
                              ) as per_dish
                   from menus m
                   where not exists (select 1 from caller c where c.id = m.profile_id)
                     and menu_is_publishable(m.id)
                     -- The tile LINKS to the main, so the main itself has to be
                     -- catalogue. `community_menus_for_recipe` needs no such
                     -- test: it is asked about a recipe the caller can already
                     -- read, and it never hands an id back.
                     and exists (select 1
                                 from recipes r
                                 where r.id = m.main_recipe_id
                                   and r.created_by is null))
select cd.main_recipe_id,
       r.name,
       cd.name,
       -- Composition order, which puts the main first — `useSaveMenu` writes the
       -- seed recipe at position 0. The mosaic reads left to right in the same
       -- order the sheet's card lists them.
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
-- Recent rather than most-chosen. The strip is evidence that people are
-- building these, and at low volume every combination has been chosen once —
-- so "popular" would sort on noise while "recent" stays true and looks alive.
order by cd.created_at desc
limit greatest(p_limit, 0);
$$;

revoke all on function recent_community_menus(integer) from public;
grant execute on function recent_community_menus(integer) to anon, authenticated;
