-- The dish picker's "Popular menus" rail was showing an empty shelf to the one
-- reader most likely to want it: somebody who has saved a menu.
--
-- `recent_community_menus` excluded anything in the caller's `saved_menus`.
-- That rule was written for a SHEET — `community_menus_for_recipe`, offering
-- menus to keep, where a card you already hold is not an offer — and it was
-- copied here when this function moved onto RLS in `20260821000003`. The rail
-- is not an offer. It is the shelf of finished dinners that says what compose
-- makes, it draws a filled heart for a menu you keep, and hiding your own
-- dinners from it means the corpus looks emptiest to the people who have used
-- the feature. With one menu in a corpus and that menu saved, the rail rendered
-- nothing at all.
--
-- So the exclusion goes, and with it the last reason this function reads
-- anything about the caller. `community_menus_for_recipe` keeps its own — it is
-- still an offer.
--
-- ## And it orders by saves now
--
-- The heading has read "Popular menus" since the rail moved off the home feed;
-- the ordering was still `created_at desc`, which `20260819000004` argued for
-- when every combination had been chosen exactly once and "popular" would have
-- sorted on noise. Saves are a real signal now, and the per-dish window has
-- already been picking the most-saved copy of each main since `…000003` — so
-- the outer sort was the one place left where the shelf disagreed with its own
-- title. `created_at desc` stays as the tie-break, which is what keeps a
-- zero-save corpus looking exactly as it did.
--
-- The NAME stays `recent_community_menus`. It is reached by name over
-- PostgREST and it is the key the generated `Database` types are written
-- against, so renaming it is a client change and a tarball rebuild for a word.
--
-- `create or replace`, not a drop: the return type is untouched, deliberately.
-- Returning `saved_count` would be truer to the new ordering and nothing draws
-- it — `CommunityMenuCard`'s footer carries the way in instead — so it would
-- cost a types regen and a repack for a number nobody reads.

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
                          m.saved_count,
                          -- One menu per DISH, so a shelf of ten shows ten
                          -- dinners rather than ten ways to serve one.
                          row_number() over (
                              partition by m.main_recipe_id
                              order by m.saved_count desc, m.created_at desc
                              ) as per_dish
                   from menus m
                   where menu_is_publishable(m.id, m.owner_profile_id, m.course_count))
select cd.id,
       cd.main_recipe_id,
       r.name,
       cd.name,
       menu_courses_resolved(cd.id)
from candidate cd
         join recipes r on r.id = cd.main_recipe_id
where cd.per_dish = 1
order by cd.saved_count desc, cd.created_at desc
limit greatest(p_limit, 0);
$$;

comment on function recent_community_menus(integer) is
    'Composed menus worth showing as examples, most-saved first, one per main dish. Curation only — it does not hide the caller''s own or the ones they keep, because the rail that draws it marks those with a filled heart.';
