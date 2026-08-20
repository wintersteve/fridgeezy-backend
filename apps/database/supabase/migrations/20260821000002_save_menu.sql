-- The one way a menu is written.
--
-- `20260821000001` left `menus` and `menu_courses` with a SELECT policy and no
-- write privilege at all, so this is not one option among several — it is the
-- only door. That is deliberate, and it closes three holes the client's own
-- three statements had: an upsert that could overwrite a shared row's name, a
-- `menu_courses` DELETE filtered only by `menu_id`, and a `menus` DELETE whose
-- entire WHERE clause was an id.
--
-- ## Find-or-create, never update
--
-- A menu is identified by `(main_recipe_id, dish_signature)`. Composing a
-- different set of dishes is therefore composing a DIFFERENT menu, not editing
-- this one — so there is no update path here, and re-saving simply repoints the
-- caller's reference. Nothing a second saver does can alter what the first one
-- sees.
--
-- ## The snapshot is READ, not accepted
--
-- `menu_courses.name` / `description` / `image` used to be caller-supplied, and
-- that was survivable while a menu was visible only to its author. It is not
-- survivable now: those columns are world-readable and they are drawn on the
-- home feed's strip, so trusting them would make compose an unmoderated
-- free-text-and-image channel onto everybody's feed. This function is SECURITY
-- DEFINER; it can read the catalogue itself, so it does.
--
-- Two things fall out of that for free. `is_recipe` is derived rather than
-- believed, which retires the stale-`is_recipe` case the compose screen carries
-- a paragraph of comment about. And a suggestion course gets a NULL image
-- rather than a client-computed URI — which is the better answer anyway, since
-- `DishImage` falls back to `recipeImageUri(name)` built from the client's own
-- env, and a stored URI is how rows ended up pinned to an expired LAN lease.
--
-- Only `p_name` still comes from the caller, and it is trimmed and capped
-- (`saved_menus_label_check`) rather than trusted.

------------------------------------------------------------------------------
-- 1. Resolving a course payload against the catalogue
------------------------------------------------------------------------------
--
-- Written once because `save_menu` needs it twice — for the identity, then for
-- the rows — and a divergence between those two would mint a menu whose
-- signature does not describe its own courses.
--
-- SECURITY INVOKER, which sounds wrong for something reading rows the caller
-- may not see and is not: it is called only from inside `save_menu`, which is
-- definer, so it inherits that. Called directly by a client it reads exactly
-- what that client could read anyway.

create or replace function public.menu_course_input(p_courses jsonb)
    returns table
            (
                course_position integer,
                course_type     text,
                recipe_id       uuid,
                is_recipe       boolean,
                dish_key        uuid,
                created_by      uuid,
                name            text,
                description     text,
                difficulty      difficulty_type,
                image           text
            )
    language sql
    stable
as
$function$
select (t.ord - 1)::integer,
       coalesce(nullif(btrim(t.e ->> 'courseType'), ''), 'side'),
       coalesce(r.id, s.id),
       -- Derived, never taken from the payload.
       r.id is not null,
       -- Normalised to the suggestion a dish descends from, so a menu composed
       -- before a promotion and one composed after collapse onto one row. That
       -- is the common case rather than a corner: `find_recipes` hides a
       -- suggestion once its dish has a recipe, so later composers get the
       -- recipe where earlier ones got the suggestion.
       coalesce(r.source_suggestion_id, r.id, s.id),
       r.created_by,
       coalesce(r.name, s.name),
       coalesce(r.description, s.description),
       coalesce(r.difficulty, s.difficulty),
       -- `recipe_suggestions` has no image column; NULL is the honest answer
       -- and the client's name-derived fallback is the right one.
       r.image
from jsonb_array_elements(p_courses) with ordinality as t(e, ord)
         left join recipes r on r.id = nullif(t.e ->> 'recipeId', '')::uuid
         left join recipe_suggestions s on s.id = nullif(t.e ->> 'recipeId', '')::uuid;
$function$;

comment on function public.menu_course_input(jsonb) is
    'Resolves [{recipeId, courseType}] against recipes/recipe_suggestions. The snapshot columns are READ here, never taken from the caller — see 20260821000002.';

revoke all on function public.menu_course_input(jsonb) from public;

------------------------------------------------------------------------------
-- 2. save_menu
------------------------------------------------------------------------------

create or replace function public.save_menu(
    p_name           text,
    p_main_recipe_id uuid,
    p_courses        jsonb
)
    returns menus
    language plpgsql
    security definer
    -- `pg_temp` listed LAST and EXPLICITLY. Leave it out and Postgres still
    -- searches it first for table names, so a caller holding a session could
    -- `create temp table menus (...)` and have this write there, as the owner.
    -- The `search_path = public` on the older definer functions has the same
    -- gap; they are not reachable this way over PostgREST, but this one is the
    -- write path.
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
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'save_menu: no profile for the current user';
    end if;

    select array_agg(c.dish_key order by c.dish_key),
           count(*)::integer,
           -- uuid has no `max()`. There is at most one answer regardless: a
           -- caller can only compose with recipes they can read.
           (array_agg(c.created_by) filter (where c.created_by is not null))[1]
    into v_signature, v_count, v_owner
    from menu_course_input(p_courses) c
    -- An id that is neither a recipe nor a suggestion resolves to NULL and is
    -- dropped rather than failing the save: it is a course that no longer
    -- exists, and losing it is better than losing the meal.
    where c.recipe_id is not null;

    if coalesce(v_count, 0) = 0 then
        raise exception using
            errcode = 'check_violation',
            message = 'save_menu: a menu needs at least one course';
    end if;

    select r.created_by into v_main_owner from recipes r where r.id = p_main_recipe_id;

    if not found then
        raise exception using
            errcode = 'no_data_found',
            message = format('save_menu: no recipe %s to build a menu around', p_main_recipe_id);
    end if;

    -- The main is folded in whether or not it is among the courses. This is
    -- what makes "owner is null" imply "the main is catalogue", which is what
    -- lets `menu_is_publishable` be two columns instead of a join.
    v_owner := coalesce(v_owner, v_main_owner);

    if v_owner is not null and v_owner <> v_profile_id then
        -- Unreachable through RLS — which is exactly why it is here. This
        -- function runs as the definer, so `menu_course_input` above CAN see
        -- another profile's imported recipes, and without this test a caller
        -- who guessed an id would mint a menu snapshotting its name.
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'save_menu: a course belongs to another profile';
    end if;

    insert into menus (name, main_recipe_id, dish_signature, owner_profile_id, course_count)
    values (left(btrim(coalesce(p_name, '')), 120), p_main_recipe_id,
            v_signature, v_owner, v_count)
    on conflict (main_recipe_id, dish_signature) do nothing
    returning * into v_menu;

    if v_menu.id is null then
        -- Somebody already composed this. Their courses stand — course types,
        -- positions and images included. The caller's own title is not lost,
        -- it goes on their `saved_menus.label` below.
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

    -- The reference. `main_recipe_id` is filled by the BEFORE trigger, so the
    -- conflict target is satisfied without this statement naming it: re-saving
    -- the same main with a different set of dishes repoints `menu_id`, which is
    -- the UPDATE arm `sync_menu_saved_count` exists for.
    insert into saved_menus (profile_id, menu_id, label)
    values (v_profile_id, v_menu.id, nullif(left(btrim(coalesce(p_name, '')), 120), ''))
    on conflict (profile_id, main_recipe_id)
        do update set menu_id = excluded.menu_id,
                      label   = excluded.label;

    return v_menu;
end;
$function$;

comment on function public.save_menu(text, uuid, jsonb) is
    'Find-or-create a shared menu by (main_recipe_id, dish_signature) and point the caller''s saved_menus reference at it. The only write path into menus/menu_courses — see 20260821000002.';

revoke all on function public.save_menu(text, uuid, jsonb) from public;
grant execute on function public.save_menu(text, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
