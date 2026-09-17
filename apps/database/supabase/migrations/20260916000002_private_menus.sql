-- A menu you put together yourself is yours, not the corpus's.
--
-- `record_menu` files every composition into the shared `menus` table. That was
-- right while every course came from the composer or from the catalogue's own
-- answer for that slot, and it stops being right the moment the picker lets
-- somebody search the whole catalogue: a sushi main with a grilled cheese
-- beside it becomes a `menus` row with `owner_profile_id` null, shown on the
-- community rail and — worse — served back through `menu_pairings_for_recipe`
-- as a PAIRING to the next person composing around sushi.
--
-- ## The rule is provenance, not judgement
--
-- The client knows where each course came from: a saved menu (`matched`), the
-- dish's pairing set (`proposed`), or the search field (`chosen`). All matched
-- or proposed means the combination was put together by the layer that thinks
-- about this dish, and it goes into the corpus as before. One `chosen` course
-- makes the whole menu private.
--
-- No model judges coherence and nothing new can fail. "Conceptually sensible"
-- IS "proposed by the pairing layer", and an odd pairing can only arrive
-- through free search. The asymmetry is deliberate: a reader who searches for
-- the dish the model would have proposed anyway gets a private menu — a false
-- negative costing the corpus one row — where the reverse puts nonsense in
-- front of strangers. It fails towards private.
--
-- ## Nothing downstream changes
--
-- `menu_is_visible(owner_profile_id)` (RLS) and `menu_is_publishable(...)`
-- (curation) BOTH already require the column to be null. So a private menu is
-- already hidden from every other reader, already absent from
-- `recent_community_menus` and `community_menus_for_recipe`, and already
-- invisible to compose retrieval. The only thing this migration changes is who
-- sets the column — and the unique key, which cannot survive it.
--
-- ## The identity key HAS to change, and this is the sharp edge
--
-- `menus_identity_key` is `unique (main_recipe_id, dish_signature)`, with no
-- owner in it. That is safe TODAY only by accident: a menu is owned only when
-- it contains an imported recipe, and an imported recipe is visible to exactly
-- one profile, so two profiles can never compose the same owned set.
--
-- Once ownership can come from provenance instead, they can. Two readers
-- privately composing the same dishes collide: the second gets
-- `on conflict do nothing`, falls into the re-select below, and reads back the
-- FIRST reader's private row — which RLS then hides from them. `save_menu`
-- would go on to write a `saved_menus` row pointing at a menu its owner cannot
-- open, and their saved meals list would carry a hole.
--
-- `nulls not distinct` is what keeps the shared corpus collapsing onto one row
-- exactly as it does now, which is the half that would otherwise break: with
-- the default `nulls distinct`, every shared menu would be unique against every
-- other and the find-or-create would mint a row per composition. Postgres 15+;
-- this project is on 17.

------------------------------------------------------------------------------
-- 1. The identity key
------------------------------------------------------------------------------

alter table menus
    drop constraint if exists menus_identity_key;

alter table menus
    add constraint menus_identity_key
        unique nulls not distinct (main_recipe_id, dish_signature, owner_profile_id);

comment on constraint menus_identity_key on menus is
    'A menu IS its main plus its dishes plus its owner. NULLS NOT DISTINCT so the shared corpus (owner null) still collapses to one row per combination — see 20260916000002.';

------------------------------------------------------------------------------
-- 2. record_menu learns to keep one to itself
------------------------------------------------------------------------------
--
-- `p_private` DEFAULTS TO TRUE, and the direction is the point. A caller that
-- does not say where its dishes came from cannot vouch for them — which
-- describes every build shipped before this migration, composing through the
-- old course-and-cuisine picker this whole change exists to remove. PostgREST
-- resolves an RPC by the argument names in the body, so a three-argument call
-- from an installed build still binds to this function and simply takes the
-- default. No overload, no 404, and the old behaviour lands on the safe side.
--
-- The lookup order below is what makes that safe in the other direction too —
-- see the comments on each branch.

create or replace function public.record_menu(
    p_name           text,
    p_main_recipe_id uuid,
    p_courses        jsonb,
    p_private        boolean default true
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
    -- Still an authenticated write. Not because the row is attributed — a
    -- shared one is not — but because the owner test below needs to know who is
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

    -- A menu containing somebody's own imported recipe is private whatever the
    -- caller says: `v_owner` is a HARD constraint and `p_private` can only ever
    -- add to it. Written as two steps rather than one `coalesce` so that is
    -- legible — the two reasons a menu is private are unrelated and only one of
    -- them is a choice.
    if v_owner is null and p_private then
        -- Already public, so there is nothing left to protect. Somebody reached
        -- this combination through the pairing layer before, and a second
        -- private copy would split `saved_count` between two rows describing
        -- one dinner.
        select * into v_menu
        from menus
        where main_recipe_id = p_main_recipe_id
          and dish_signature = v_signature
          and owner_profile_id is null;

        if v_menu.id is not null then
            return v_menu;
        end if;

        v_owner := v_profile_id;
    end if;

    -- The other direction, and the one that keeps a re-save honest: this caller
    -- already holds a PRIVATE row for exactly these dishes. Publishing over it
    -- is the one thing this function must never do — `saved-menu-detail`'s
    -- heart re-sends the courses it is showing, and without this a reader
    -- re-saving their own private meal would push it into the corpus.
    --
    -- It also means a menu recorded private stays private even if the same
    -- reader later assembles it entirely from proposals. Accepted: fails
    -- closed, and the cost is one row the corpus does not get.
    if v_owner is null then
        select * into v_menu
        from menus
        where main_recipe_id = p_main_recipe_id
          and dish_signature = v_signature
          and owner_profile_id = v_profile_id;

        if v_menu.id is not null then
            return v_menu;
        end if;
    end if;

    insert into menus (name, main_recipe_id, dish_signature, owner_profile_id, course_count)
    values (left(btrim(coalesce(p_name, '')), 120), p_main_recipe_id,
            v_signature, v_owner, v_count)
    on conflict (main_recipe_id, dish_signature, owner_profile_id) do nothing
    returning * into v_menu;

    if v_menu.id is null then
        -- Somebody already composed this exact set, at this visibility. Their
        -- courses stand — course types, positions and images included — and the
        -- caller has not created anything, they have arrived at what exists.
        -- Which is the whole point of recording: the second person to find a
        -- pairing should land on the first person's row, not beside it.
        --
        -- `is not distinct from` rather than `=`, because `v_owner` is null for
        -- the shared corpus and `null = null` is not true. The conflict target
        -- above is NULLS NOT DISTINCT, so it matched a row this predicate has
        -- to be able to find again.
        select * into v_menu
        from menus
        where main_recipe_id = p_main_recipe_id
          and dish_signature = v_signature
          and owner_profile_id is not distinct from v_owner;
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

comment on function public.record_menu(text, uuid, jsonb, boolean) is
    'Find-or-create a menu for a combination, WITHOUT keeping it. `p_private` (default TRUE) files it under the caller instead of the shared corpus — set false only when every course came from the pairing layer. See 20260916000002.';

revoke all on function public.record_menu(text, uuid, jsonb, boolean) from public;
grant execute on function public.record_menu(text, uuid, jsonb, boolean) to authenticated;

-- The three-argument form is gone as a distinct function, replaced by the
-- default above. Dropped explicitly rather than left: two overloads would make
-- PostgREST's resolution depend on which keys a client happened to send, and
-- the three-argument body would have silently kept the old, always-shared
-- behaviour for anybody who did not pass `p_private`.
drop function if exists public.record_menu(text, uuid, jsonb);

------------------------------------------------------------------------------
-- 3. save_menu passes it through
------------------------------------------------------------------------------

create or replace function public.save_menu(
    p_name           text,
    p_main_recipe_id uuid,
    p_courses        jsonb,
    p_private        boolean default true
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

    -- The combination first, by the one path that creates one. Every check that
    -- used to live here — the course resolution, the owner test, the identity —
    -- is in there, so the two verbs cannot disagree about what a menu IS, and
    -- now also cannot disagree about whose it is.
    v_menu := record_menu(p_name, p_main_recipe_id, p_courses, p_private);

    -- Then the opinion. Re-saving the same main with a different set of dishes
    -- repoints `menu_id`, which is the UPDATE arm `sync_menu_saved_count`
    -- exists for; the menu let go of survives at `saved_count` 0 and is still
    -- discoverable, because it is still a real combination somebody composed.
    insert into saved_menus (profile_id, menu_id, label)
    values (v_profile_id, v_menu.id,
            nullif(left(btrim(coalesce(p_name, '')), 120), ''))
    on conflict (profile_id, main_recipe_id)
        do update set menu_id = excluded.menu_id,
                      label   = excluded.label;

    return v_menu;
end;
$function$;

comment on function public.save_menu(text, uuid, jsonb, boolean) is
    'Record a combination and keep it: `record_menu` plus this profile''s saved_menus reference. `p_private` defaults TRUE — see 20260916000002.';

revoke all on function public.save_menu(text, uuid, jsonb, boolean) from public;
grant execute on function public.save_menu(text, uuid, jsonb, boolean) to authenticated;

drop function if exists public.save_menu(text, uuid, jsonb);

------------------------------------------------------------------------------
-- 4. Prove the overloads are gone
------------------------------------------------------------------------------
--
-- The same shape `20260822000003` uses for `menu_is_publishable`, and for the
-- same reason: a leftover three-argument copy would be picked up by a client
-- that omits `p_private` and would quietly publish every menu it recorded.

do
$$
declare
    v_count integer;
begin
    select count(*) into v_count
    from pg_proc
    where proname in ('record_menu', 'save_menu')
      and pronamespace = 'public'::regnamespace;

    if v_count <> 2 then
        raise exception 'expected exactly one record_menu and one save_menu, found % overloads', v_count;
    end if;
end
$$;

notify pgrst, 'reload schema';
