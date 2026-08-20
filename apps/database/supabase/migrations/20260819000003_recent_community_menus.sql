-- Menus for the home feed's compose module, and the rule both menu readers share.
--
-- The compose card is a pitch with nothing behind it: it describes what a menu
-- is and asks you to pay to find out. Real menus argue for it better than the
-- copy does. This is the unscoped read behind that strip — the recipe-screen
-- badge answers "for THIS dish", which is the wrong question on a feed where
-- the reader has not chosen a dish yet.

-- Whether a menu may be shown to somebody who does not own it.
--
-- Written ONCE because it now has two callers, and a divergence between them
-- would be a privacy leak in whichever one drifted rather than an error. Same
-- argument as `recipe_is_visible`, which is the model for this.
--
-- Not SECURITY DEFINER, and execute is revoked: it is only ever called from
-- inside the definer functions below, which run as the owner and can therefore
-- reach it. Nothing outside them has any business asking.
create or replace function menu_is_publishable(p_menu_id uuid)
    returns boolean
    language sql
    stable
    set search_path = public
as
$$
select
    -- An imported recipe is visible to exactly one profile, and `menu_courses`
    -- SNAPSHOTS its name — so a menu touching one cannot be shown to anybody,
    -- or the snapshot leaks the name off someone's own cookbook page.
    -- Suggestions need no such test: `recipe_suggestions` is `public_read` with
    -- no owner column, so a course awaiting promotion is catalogue data.
    not exists (select 1
                from menu_courses mc
                         join recipes r on r.id = mc.recipe_id
                where mc.menu_id = p_menu_id
                  and mc.is_recipe
                  and r.created_by is not null)
        -- A menu of one dish is the dish. It is not an example of anything.
        and (select count(*) from menu_courses mc where mc.menu_id = p_menu_id) > 1;
$$;

revoke all on function menu_is_publishable(uuid) from public;

-- Re-stated over the shared helper. The inline copy this replaces was the only
-- statement of the rule; now that a second reader exists it has to be one thing.
create or replace function community_menus_for_recipe(
    p_recipe_id uuid,
    p_limit     integer default 5
)
    returns table
            (
                menu_title    text,
                profile_count bigint,
                courses       jsonb
            )
    language sql
    stable
    security definer
    set search_path = public
as
$$
with caller as (select id from profiles where user_id = auth.uid()),
     candidate as (select m.id, m.profile_id, m.name
                   from menus m
                   where m.main_recipe_id = p_recipe_id
                     and not exists (select 1 from caller c where c.id = m.profile_id)
                     and menu_is_publishable(m.id)),
     shaped as (select cd.id,
                       cd.profile_id,
                       cd.name,
                       (select array_agg(mc.recipe_id order by mc.recipe_id)
                        from menu_courses mc
                        where mc.menu_id = cd.id) as dish_set,
                       (select jsonb_agg(jsonb_build_object(
                                                 'recipeId', mc.recipe_id,
                                                 'isRecipe', mc.is_recipe,
                                                 'courseType', mc.course_type,
                                                 'name', mc.name,
                                                 'image', mc.image
                                             ) order by mc.position)
                        from menu_courses mc
                        where mc.menu_id = cd.id) as courses
                from candidate cd)
select mode() within group (order by s.name)    as menu_title,
       count(distinct s.profile_id)             as profile_count,
       (array_agg(s.courses order by s.id))[1]  as courses
from shaped s
group by s.dish_set
order by count(distinct s.profile_id) desc, min(s.name)
limit greatest(p_limit, 0);
$$;

-- The home feed's strip: recent menus across the catalogue, one per dish.
--
-- Returns only what a tile draws rather than the whole course list — the strip
-- shows a picture, a title and a count, and shipping courses it will not render
-- is payload per home-feed render for nobody.
create or replace function recent_community_menus(p_limit integer default 6)
    returns table
            (
                main_recipe_id uuid,
                main_name      text,
                main_image     text,
                menu_title     text,
                course_count   integer
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
       r.image,
       cd.name,
       (select count(*)::integer from menu_courses mc where mc.menu_id = cd.id)
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

comment on function recent_community_menus(integer) is
    'Recent menus across the catalogue, one per main dish, for the home feed''s compose strip. SECURITY DEFINER over own-profile tables; excludes the caller''s own and anything `menu_is_publishable` refuses.';
