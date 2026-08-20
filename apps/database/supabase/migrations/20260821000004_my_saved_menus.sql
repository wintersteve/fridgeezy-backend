-- The saved-meals list, read in one round trip and resolved on the way out.
--
-- Two things the client cannot do for itself over PostgREST, and one it should
-- never be able to do again.
--
-- ## Resolution, which is what replaces the reconcile
--
-- A course saved while its dish was still a suggestion keeps pointing at that
-- suggestion for good. `menu_courses` used to be PATCHED when the suggestion
-- was promoted — a client-side UPDATE filtered on `recipe_id` alone, with no
-- menu scope, which was survivable only while RLS made "my menus" the whole
-- table. On a shared table that statement rewrites everybody's menus, so it is
-- gone.
--
-- It cannot come back as a definer RPC either. The obvious safe form would
-- verify `recipes.source_suggestion_id = <suggestion>` before rewriting — but
-- `promote.ts` deliberately leaves that column NULL when it serves an ADAPTED
-- variant (one caller's blacklist-adjusted copy is not "the catalogue recipe
-- this suggestion became"), so the check would fail for exactly the case the
-- reconcile existed to fix, and the course would stay unopenable forever on
-- every device.
--
-- So nothing is rewritten. `dish_key` is immutable and the pointer is resolved
-- HERE, at read time, for everyone at once. The adapted case degrades to "still
-- a suggestion" server-side, exactly as it does today, and the client's own
-- `useGeneratedRecipeStore` still covers it on the device that generated it.
--
-- ## The footgun it closes
--
-- `useMenus` was `from("menus").select("*, menu_courses(*)")` with no filter at
-- all — scoped entirely by a policy that no longer scopes anything. Leaving the
-- saved-meals list as a table read one predicate away from being "every menu in
-- the product" is not a risk worth keeping for the sake of a shorter migration.

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
    -- INVOKER. RLS on `saved_menus` is what makes this "mine" — there is no
    -- profile parameter, because a profile id in a signature is a profile id a
    -- caller can change (20260815000004).
as
$$
select m.id,
       -- The caller's own title, falling back to the first composer's. Two
       -- people who picked the same dishes share the menu but not the wording.
       coalesce(s.label, m.name),
       -- `saved_at`, not the menu's `created_at`: the list is newest-first and
       -- what that has to mean is "when I saved it".
       s.created_at,
       m.main_recipe_id,
       m.saved_count,
       (select jsonb_agg(jsonb_build_object(
                                 'recipeId', coalesce(rp.id, mc.recipe_id),
                                 -- A suggestion that has since been promoted is
                                 -- a recipe now, whoever promoted it.
                                 'isRecipe', rp.id is not null or mc.is_recipe,
                                 'courseType', mc.course_type,
                                 'name', mc.name,
                                 'description', coalesce(mc.description, rp.description),
                                 'difficulty', coalesce(mc.difficulty, rp.difficulty),
                                 -- The recipe's own art wins: a course saved as
                                 -- a suggestion had no photo, and gaining one is
                                 -- the visible half of being promoted.
                                 'image', coalesce(rp.image, mc.image)
                             ) order by mc.position)
        from menu_courses mc
                 left join lateral (select r.id, r.description, r.difficulty, r.image
                                    from recipes r
                                    where r.source_suggestion_id = mc.dish_key
                                    limit 1) rp on true
        where mc.menu_id = m.id)
from saved_menus s
         join menus m on m.id = s.menu_id
order by s.created_at desc;
$$;

comment on function public.my_saved_menus() is
    'The caller''s saved meals, courses resolved through dish_key so a promoted suggestion opens. SECURITY INVOKER — RLS on saved_menus is the scope.';

revoke all on function public.my_saved_menus() from public;
grant execute on function public.my_saved_menus() to authenticated;

notify pgrst, 'reload schema';
