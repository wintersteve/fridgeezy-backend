-- One menu by id, and the course resolution written once.
--
-- `20260821000004` put the `dish_key` resolution inside `my_saved_menus()`.
-- The detail screen needs the identical thing for a menu the caller may NOT
-- have saved — it is reachable from the home feed's strip, from the menus
-- sheet, and from a deep link — so the expression now has two callers and is
-- extracted before it has a chance to drift. A divergence between them would
-- not error; one screen would simply stop opening promoted courses.
--
-- This is what `community_menu(uuid)` used to be, minus the SECURITY DEFINER
-- and minus the aggregation it needed to fake a `profile_count`. It is back as
-- a function only because of the resolution and the "have I saved this" flag;
-- everything else about it is now a plain readable row.

create or replace function public.menu_courses_resolved(p_menu_id uuid)
    returns jsonb
    language sql
    stable
as
$function$
select jsonb_agg(jsonb_build_object(
                         -- The as-saved pointer, followed to whatever the dish
                         -- was promoted into. Nothing is ever written back: see
                         -- 20260821000004 for why the reconcile had to go.
                         'recipeId', coalesce(rp.id, mc.recipe_id),
                         'isRecipe', rp.id is not null or mc.is_recipe,
                         'courseType', mc.course_type,
                         'name', mc.name,
                         'description', coalesce(mc.description, rp.description),
                         'difficulty', coalesce(mc.difficulty, rp.difficulty),
                         'image', coalesce(rp.image, mc.image)
                     ) order by mc.position)
from menu_courses mc
         left join lateral (select r.id, r.description, r.difficulty, r.image
                            from recipes r
                            where r.source_suggestion_id = mc.dish_key
                            limit 1) rp on true
where mc.menu_id = p_menu_id;
$function$;

comment on function public.menu_courses_resolved(uuid) is
    'A menu''s courses as jsonb, each pointer resolved through dish_key. The single copy — my_saved_menus and menu_by_id both call it.';

grant execute on function public.menu_courses_resolved(uuid) to anon, authenticated;

create or replace function public.my_saved_menus()
    returns table
            (
                menu_id        uuid,
                menu_name      text,
                saved_at       timestamp with time zone,
                main_recipe_id uuid,
                saved_count    integer,
                courses        jsonb
            )
    language sql
    stable
as
$function$
select m.id,
       coalesce(s.label, m.name),
       s.created_at,
       m.main_recipe_id,
       m.saved_count,
       menu_courses_resolved(m.id)
from saved_menus s
         join menus m on m.id = s.menu_id
order by s.created_at desc;
$function$;

-- One menu, whoever composed it and whether or not the caller keeps it.
--
-- RLS on `menus` is the whole access rule: an owned menu simply returns no
-- rows, which the screen renders as "not here" — the same answer a deleted one
-- gives, and deliberately indistinguishable from it.
create or replace function public.menu_by_id(p_menu_id uuid)
    returns table
            (
                menu_id        uuid,
                menu_name      text,
                main_recipe_id uuid,
                main_name      text,
                saved_count    integer,
                is_saved       boolean,
                courses        jsonb
            )
    language sql
    stable
as
$function$
select m.id,
       -- The caller's own label when they keep it, the composer's otherwise.
       -- The same menu genuinely reads under two names, and which one you get
       -- depends on whether it is yours.
       coalesce(s.label, m.name),
       m.main_recipe_id,
       r.name,
       m.saved_count,
       s.id is not null,
       menu_courses_resolved(m.id)
from menus m
         join recipes r on r.id = m.main_recipe_id
         left join saved_menus s
                   on s.menu_id = m.id and s.profile_id = current_profile_id()
where m.id = p_menu_id;
$function$;

comment on function public.menu_by_id(uuid) is
    'One menu by id, with the caller''s own label and whether they keep it. SECURITY INVOKER — RLS on menus decides whether it returns anything.';

revoke all on function public.menu_by_id(uuid) from public;
grant execute on function public.menu_by_id(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
