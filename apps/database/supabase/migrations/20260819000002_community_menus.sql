-- "Nine people composed a menu around this dish. Here are three of them."
--
-- Compose is the only route in the product that costs money per call, and it
-- asks the user to pay it before they have any idea what comes back. Menus that
-- already exist answer that for free, and often instead.
--
-- SHAPE, and why it is this one: `menus` and `menu_courses` stay own-profile
-- under RLS exactly as they are, and the cross-user read happens only inside a
-- SECURITY DEFINER function that returns an AGGREGATE. That is not a new
-- pattern here — `find_recipes` already ranks by likes over
-- `profile_recipe_interactions`, which is own-profile under RLS for the same
-- reason. No policy is widened, so nothing else in the schema gains a way to
-- read another profile's rows.

-- `menus` has an index on profile_id and a unique on (profile_id,
-- main_recipe_id); neither serves a lookup by main recipe alone, which is the
-- only access path this function has.
create index if not exists idx_menus_main_recipe_id
    on menus using btree (main_recipe_id);

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
    -- Reads other profiles' menus, which every policy on those tables forbids.
    -- The pinned search_path is not decoration: without it a caller can put a
    -- schema of their own ahead of `public` and have this run against their own
    -- `menus`, as the definer.
    security definer
    set search_path = public
as
$$
with caller as (select id from profiles where user_id = auth.uid()),
     -- Menus somebody ELSE composed around this dish.
     candidate as (select m.id, m.profile_id, m.name
                   from menus m
                   where m.main_recipe_id = p_recipe_id
                     and not exists (select 1 from caller c where c.id = m.profile_id)
                     -- An imported recipe is visible to exactly one profile, and
                     -- `menu_courses` SNAPSHOTS its name — so a menu touching one
                     -- cannot be shown to anybody, or the snapshot leaks the name
                     -- off someone's own cookbook page. Suggestions need no such
                     -- test: `recipe_suggestions` is `public_read` with no owner
                     -- column, so a course still awaiting promotion is catalogue
                     -- data like any other.
                     and not exists (select 1
                                     from menu_courses mc
                                              join recipes r on r.id = mc.recipe_id
                                     where mc.menu_id = m.id
                                       and mc.is_recipe
                                       and r.created_by is not null)),
     shaped as (select cd.id,
                       cd.profile_id,
                       cd.name,
                       -- WHICH dishes, order-independent: the identity of a menu
                       -- for grouping. Two people who picked the same three
                       -- dishes composed the same menu, whatever order the
                       -- stream happened to fill the slots in.
                       (select array_agg(mc.recipe_id order by mc.recipe_id)
                        from menu_courses mc
                        where mc.menu_id = cd.id)                       as dish_set,
                       (select count(*) from menu_courses mc where mc.menu_id = cd.id) as course_count,
                       (select jsonb_agg(jsonb_build_object(
                                                 'recipeId', mc.recipe_id,
                                                 'isRecipe', mc.is_recipe,
                                                 'courseType', mc.course_type,
                                                 'name', mc.name,
                                                 'image', mc.image
                                             ) order by mc.position)
                        from menu_courses mc
                        where mc.menu_id = cd.id)                       as courses
                from candidate cd)
select
    -- One title per combination. `mode()` rather than any-of-them so the same
    -- set of dishes always reads back under the same name — the titles are
    -- model-generated and differ between compositions of the identical menu.
    mode() within group (order by s.name)                as menu_title,
    count(distinct s.profile_id)                         as profile_count,
    -- Any one representative. The snapshots agree on WHICH dishes by
    -- construction (that is what `dish_set` groups on) and can differ only in a
    -- name or image captured at different times; `min(s.id)` picks one
    -- deterministically so the sheet does not reshuffle between reads.
    (array_agg(s.courses order by s.id))[1]              as courses
from shaped s
-- A menu of one dish is the dish. It is not an example of anything.
where s.course_count > 1
group by s.dish_set
order by count(distinct s.profile_id) desc, min(s.name)
limit greatest(p_limit, 0);
$$;

-- Deliberately readable by a GUEST as well. The recipe screen this badge sits on
-- is part of the catalogue every tier can browse, and the point of the feature
-- is to show what compose produces to someone who has not paid for it.
--
-- Nothing here is attributable: no profile id is returned, the dish names are
-- catalogue rows, and the titles are written by our own model rather than by a
-- user — there is no rename affordance anywhere in the client.
revoke all on function community_menus_for_recipe(uuid, integer) from public;
grant execute on function community_menus_for_recipe(uuid, integer) to anon, authenticated;

comment on function community_menus_for_recipe(uuid, integer) is
    'Distinct menus other profiles composed around a recipe, most-chosen first. SECURITY DEFINER over own-profile tables, returning an aggregate only — see 20260819000002. Excludes the caller''s own menus and any menu touching an imported recipe.';
