-- The discovery reads, now that there is nothing to reach past.
--
-- All three of these were SECURITY DEFINER for one reason: `menus` was
-- own-profile under RLS, so showing anybody else's took a function that ran as
-- the owner and handed back an aggregate. `20260821000001` made the table
-- readable, so the bypass has no job left. They become SECURITY INVOKER, which
-- means RLS is what enforces the boundary again rather than a hand-written
-- WHERE clause that has to remember to — the same correction
-- `20260815000006` made to `find_recipes`, in the other direction.
--
-- They also lose their aggregation entirely. `dish_set`, `mode() within group`
-- and `count(distinct profile_id)` were all re-deriving at read time what is
-- now stored: the identity is `menus_identity_key`, the title is the row's, and
-- the count is `saved_count`.
--
-- `community_menu(uuid)` is DROPPED rather than rewritten. It existed only
-- because a client could not select a menu by id; now it can, and the plain
-- read is strictly better — it returns the description and difficulty the
-- detail screen currently has to null out.

------------------------------------------------------------------------------
-- 1. The curation rule, separated from the privacy one
------------------------------------------------------------------------------
--
-- `menu_is_publishable` used to mean both "safe to show anybody" and "worth
-- showing anybody", and conflating them is what would hide your own
-- single-course menu from you the moment the privacy half moved into RLS.
-- Privacy is `menu_is_visible` (20260821000001) and lives in the policies.
-- This is curation and lives in the queries below, nowhere else.
--
-- Two columns, no subquery. "The main must be catalogue" — which
-- `recent_community_menus` and `community_menu` each tested separately — is
-- absorbed: `save_menu` folds the main's `created_by` into `owner_profile_id`,
-- so an owned main means a non-null owner.

create or replace function public.menu_is_publishable(
    p_owner_profile_id uuid,
    p_course_count integer
)
    returns boolean
    language sql
    immutable
as
$function$
select p_owner_profile_id is null
    and p_course_count > 1;
$function$;

comment on function public.menu_is_publishable(uuid, integer) is
    'Is this menu worth showing as an example: shared corpus, and more than one dish. CURATION, not privacy — privacy is menu_is_visible and is enforced by RLS.';

grant execute on function public.menu_is_publishable(uuid, integer) to anon, authenticated;

------------------------------------------------------------------------------
-- 2. Menus other people composed around this dish
------------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced: the return type gains `menu_id`,
-- and `create or replace` refuses that (42P13). Safe because nothing holds a
-- reference — it is called by name over PostgREST.
--
-- The id is new and is the point: the sheet's cards had nowhere to go before,
-- because a menu somebody else composed had no row the caller could read.

drop function if exists community_menus_for_recipe(uuid, integer);

create function community_menus_for_recipe(
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
    -- INVOKER now. RLS on `menus` and `menu_courses` is the boundary; this
    -- function only decides what is worth showing.
as
$$
select m.id,
       m.name,
       m.saved_count,
       (select jsonb_agg(jsonb_build_object(
                                 'recipeId', mc.recipe_id,
                                 'isRecipe', mc.is_recipe,
                                 'courseType', mc.course_type,
                                 'name', mc.name,
                                 'image', mc.image
                             ) order by mc.position)
        from menu_courses mc
        where mc.menu_id = m.id)
from menus m
where m.main_recipe_id = p_recipe_id
  and menu_is_publishable(m.owner_profile_id, m.course_count)
  -- Nobody keeps it, so it is not an example of anything. A menu is created BY
  -- a save, so this only excludes one everybody has since let go.
  and m.saved_count > 0
  -- "Somebody ELSE's" is now "one I have not saved", which is the same
  -- question asked of the right table. The caller's own copy is shown to them
  -- by the sheet from `useMenus`, pinned first.
  and not exists (select 1
                  from saved_menus sm
                  where sm.menu_id = m.id
                    and sm.profile_id = current_profile_id())
order by m.saved_count desc, m.name
limit greatest(p_limit, 0);
$$;

revoke all on function community_menus_for_recipe(uuid, integer) from public;
grant execute on function community_menus_for_recipe(uuid, integer) to anon, authenticated;

comment on function community_menus_for_recipe(uuid, integer) is
    'Menus other profiles composed around a recipe, most-kept first. SECURITY INVOKER — RLS is the boundary; this only applies the curation rule.';

------------------------------------------------------------------------------
-- 3. Recent menus across the catalogue, one per dish
------------------------------------------------------------------------------
--
-- Kept as a function rather than folded into a view, for the one thing
-- PostgREST cannot express: `row_number() over (partition by main_recipe_id)`.

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

comment on function recent_community_menus(integer) is
    'Recent menus across the catalogue, one per dish, for the home feed strip. SECURITY INVOKER — RLS is the boundary.';

------------------------------------------------------------------------------
-- 4. The two that are no longer needed
------------------------------------------------------------------------------

-- A plain row read now: `menus?id=eq.X&select=*,menu_courses(*)`.
drop function if exists community_menu(uuid);

-- Superseded by the two-argument form above. Dropped AFTER its callers were
-- recreated, though the order is not load-bearing here: these bodies are
-- strings, so Postgres records no dependency on what they name.
drop function if exists menu_is_publishable(uuid);

-- One overload of each name, or PostgREST picks a leftover sibling for
-- whichever call omits the new parameter and nothing fails to say so
-- (20260815000005).
do
$$
declare
    v_count integer;
begin
    select count(*) into v_count from pg_proc where proname = 'menu_is_publishable';
    if v_count <> 1 then
        raise exception 'expected exactly one menu_is_publishable, found %', v_count;
    end if;

    select count(*) into v_count from pg_proc where proname = 'community_menus_for_recipe';
    if v_count <> 1 then
        raise exception 'expected exactly one community_menus_for_recipe, found %', v_count;
    end if;

    select count(*) into v_count from pg_proc where proname = 'recent_community_menus';
    if v_count <> 1 then
        raise exception 'expected exactly one recent_community_menus, found %', v_count;
    end if;
end
$$;

------------------------------------------------------------------------------
-- 5. The sweep learns about menus
------------------------------------------------------------------------------
--
-- `delete_orphan_generated_recipes` has never checked `menu_courses`, and that
-- was a considered trade: `20260806000001` snapshots name/description/
-- difficulty/image onto the course precisely so a swept recipe does not blank
-- the meal that used it.
--
-- The trade goes bad once menus are shared. A swept course used to be an
-- unopenable dish on one person's private card; it is now an unopenable dish on
-- everyone's copy of a menu that may be on the home feed. The snapshot still
-- keeps it RENDERABLE, which is worse rather than better — it looks fine and
-- does nothing.
--
-- Still not scheduled (see 20260801000015), so this is cheap insurance rather
-- than a behaviour change today. Body reproduced from the live definition
-- (`pg_get_functiondef`); the one edit is marked in place.

create or replace function public.delete_orphan_generated_recipes()
    returns integer
    language plpgsql
as
$function$
declare
    v_deleted INTEGER;
begin
    WITH removed AS (
        DELETE FROM recipes r
        WHERE r.is_generated = true
          AND r.created_at < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM recipe_variants v WHERE v.recipe_id = r.id OR v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipe_family_defaults d WHERE d.recipe_id = r.id OR d.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipes v WHERE v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM profile_recipe_interactions pri WHERE pri.recipe_id = r.id)
          -- THE EDIT (20260821000003). `main_recipe_id` needs no clause of its
          -- own: the main is a course.
          AND NOT EXISTS (SELECT 1 FROM menu_courses mc WHERE mc.recipe_id = r.id)
        RETURNING r.id
    )
    SELECT count(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
end;
$function$;

notify pgrst, 'reload schema';
