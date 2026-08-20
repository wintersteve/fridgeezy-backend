-- What people have actually put on a plate with this dish.
--
-- Compose has never read a menu. Asked for an appetizer to go with a main it
-- calls an LLM, even when forty people have already paired that main with the
-- same appetizer and kept it. `20260821000001` made every saved menu a shared
-- row, so that evidence now exists — this is the read that turns it into an
-- input rather than only an output.
--
-- ## The identity is `dish_key`, on both sides
--
-- Menus are matched to the base dish the way `20260821000006` matches them, and
-- candidates are grouped by `dish_key` rather than by row id. Those are the same
-- decision seen from two ends: a dish is a suggestion in the menu somebody
-- composed last month and a promoted recipe in the one composed today, and
-- without the normalisation it competes with itself for the slot.
--
-- ## Both branches, and the suggestion branch is not an edge case
--
-- A compose course is saved under its SUGGESTION id unless the user later went
-- and generated it — locally 7 of 30 courses. Returning only `recipes` rows
-- would drop that share of the evidence silently. The caller emits a recipe as
-- `source:"existing"` and a suggestion as `source:"suggestion"`, which is
-- exactly what the LLM path already produces, so both already render.
--
-- ## Written for a caller that has no RLS
--
-- The API reaches this as the SERVICE ROLE. Its siblings
-- (`community_menus_for_recipe`, `recent_community_menus`) are SECURITY INVOKER
-- and lean on the policies on `menus` — read by the service role they would hand
-- back PRIVATE menus. So `menu_is_publishable` is written into the WHERE clause
-- here, carrying both halves: `owner_profile_id is null` is the privacy rule and
-- `course_count > 1` the curation one.
--
-- For the same reason there is deliberately NO `current_profile_id()` clause.
-- Its siblings exclude menus the caller has saved; under the service role that
-- function is NULL and such a clause would be a no-op that reads as a check.
--
-- ## Blacklist and dietary are not optional here
--
-- Every dish the LLM path returns was chosen by a model that was TOLD the
-- caller's blacklist and restrictions. A retrieved dish has been seen by no
-- prompt at all, so without these tests this function is a way to put an
-- ingredient in front of somebody who said they cannot eat it. Both mirror
-- `find_recipes`: blacklist by ingredient id, dietary by the two-branch rule —
-- a derivable diet is answered from the ingredients (`recipe_dietary`),
-- everything else from the tag the row carries. A single `recipe_dietary` test
-- would return NOTHING, forever and silently, to anyone whose restriction is
-- halal, keto, kosher, low-carb, low-fat, low-sodium, high-protein or
-- flexitarian — eight of the sixteen dietary tags have no rule.
--
-- ## Every narrowing test is in the WHERE, before the cut
--
-- Not in the API after the LIMIT. `exclude` grows by one on every re-roll, so
-- filtering afterwards loses recall exactly when the caller most needs a
-- candidate — the third re-roll of a card, which is the case this feature has to
-- get right rather than a corner of it.

create or replace function public.menu_pairings_for_recipe(
    p_recipe_id     uuid,
    p_course_types  text[],
    p_per_course    integer default 3,
    p_exclude_names text[] default '{}'::text[],
    p_exclude_keys  uuid[] default '{}'::uuid[],
    p_blacklist     uuid[] default '{}'::uuid[],
    p_dietary       text[] default '{}'::text[],
    p_difficulty    text default null
)
    returns table
            (
                course_type        text,
                pair_rank          integer,
                dish_key           uuid,
                is_recipe          boolean,
                dish_id            uuid,
                name               text,
                name_en            text,
                description        text,
                short_description  text,
                difficulty         text,
                total_time_minutes integer,
                image              text,
                ingredients        jsonb,
                tags               jsonb,
                menu_ids           uuid[],
                pair_saves         integer
            )
    language sql
    stable
as
$function$
with wanted as (select distinct lower(btrim(c)) as course_type
                from unnest(p_course_types) c
                where btrim(c) <> ''),

     excluded as (select distinct lower(btrim(n)) as name
                  from unnest(p_exclude_names) n
                  where btrim(n) <> ''),

     -- Restriction NAMES resolved against the tag vocabulary they came from,
     -- rather than canonicalised here — the caller sends `tags.name` and the
     -- vocabulary is the authority on what those mean.
     diets as (select distinct t.id                              as tag_id,
                               t.canonical_id,
                               (dr.diet_canonical_id is not null) as is_derived
               from unnest(p_dietary) d
                        join tags t
                             on t.type = 'dietary'
                                 and lower(btrim(t.name)) = lower(btrim(d))
                        left join dietary_rules dr on dr.diet_canonical_id = t.canonical_id
               where btrim(d) <> ''),

     -- Subtree expansion for the tag-matched half, as `find_recipes` does
     -- (20260803000002). Flat today, so this costs nothing and cannot drift.
     diet_tags as (select s.root_id, s.tag_id
                   from tag_subtree(array(select tag_id from diets where not is_derived)) s),

     target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key),

     -- Every shared menu this dish appears in, in any slot.
     source_menu as (select m.id,
                            m.saved_count,
                            (m.main_recipe_id = p_recipe_id) as built_around
                     from menus m
                     where menu_is_publishable(m.owner_profile_id, m.course_count)
                       and m.saved_count > 0
                       and exists (select 1
                                   from menu_courses mc,
                                        target t
                                   where mc.menu_id = m.id
                                     and mc.dish_key = t.dish_key)),

     -- Their OTHER courses, in the slots being asked about.
     partner as (select mc.dish_key                     as course_key,
                        lower(btrim(mc.course_type))    as course_type,
                        sm.id                           as menu_id,
                        sm.saved_count,
                        sm.built_around
                 from source_menu sm
                          join menu_courses mc on mc.menu_id = sm.id
                          join wanted w on w.course_type = lower(btrim(mc.course_type))
                          cross join target t
                 where mc.dish_key <> t.dish_key
                   and not (mc.dish_key = any (p_exclude_keys))),

     -- The dish behind each key: a catalogue recipe if one exists, otherwise the
     -- suggestion. Normalised to the family BASE the way `find_recipes` picks
     -- one, and `created_by is null` asserted on THAT row — `promote` leaves
     -- `source_suggestion_id` NULL for an adapted variant, so without this
     -- somebody's dairy-free version is recommended to everyone.
     dish as (select k.course_key,
                     fam.id                   as recipe_id,
                     fam.source_suggestion_id as recipe_dish_key,
                     s.id                     as suggestion_id
              from (select distinct course_key from partner) k
                       left join lateral (
                  select b.id, b.source_suggestion_id
                  from recipes r
                           join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                  where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                    and b.created_by is null
                  order by (r.id = k.course_key) desc, b.id
                  limit 1) fam on true
                       left join recipe_suggestions s
                                 on fam.id is null and s.id = k.course_key),

     candidate as (select d.course_key,
                          (d.recipe_id is not null)                                as is_recipe,
                          coalesce(d.recipe_id, d.suggestion_id)                   as dish_id,
                          coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                          coalesce(r.name, s.name)                                 as name,
                          coalesce(r.name_en, s.name_en)                           as name_en,
                          coalesce(r.description, s.description)                   as description,
                          r.short_description,
                          coalesce(r.difficulty, s.difficulty)::text               as difficulty,
                          coalesce(r.total_time_minutes, s.total_time_minutes)     as total_time_minutes,
                          r.image
                   from dish d
                            left join recipes r on r.id = d.recipe_id
                            left join recipe_suggestions s on s.id = d.suggestion_id
                   where coalesce(d.recipe_id, d.suggestion_id) is not null),

     keep as (select c.*
              from candidate c
              where not exists (select 1
                                from excluded e
                                where e.name in (lower(btrim(c.name)),
                                                 lower(btrim(coalesce(c.name_en, '')))))

                and (coalesce(array_length(p_blacklist, 1), 0) = 0
                  or (c.is_recipe and not exists (select 1
                                                  from recipe_ingredients ri
                                                  where ri.recipe_id = c.dish_id
                                                    and ri.ingredient_id = any (p_blacklist)))
                  or (not c.is_recipe and not exists (select 1
                                                      from recipe_suggestion_ingredients rsi
                                                      where rsi.recipe_suggestion_id = c.dish_id
                                                        and rsi.ingredient_id = any (p_blacklist))))

                -- Every requested restriction must be satisfied, so this is
                -- "there is no diet this dish fails". An unclassified dish
                -- satisfies nothing and drops out, which is the same
                -- fail-closed answer every other dietary surface gives.
                and not exists (select 1
                                from diets dt
                                where not (case
                                               when dt.is_derived
                                                   then (c.is_recipe and exists (select 1
                                                                                 from recipe_dietary rd
                                                                                 where rd.recipe_id = c.dish_id
                                                                                   and rd.diet_canonical_id = dt.canonical_id))
                                                       or (not c.is_recipe and exists (select 1
                                                                                       from recipe_suggestion_dietary rsd
                                                                                       where rsd.recipe_suggestion_id = c.dish_id
                                                                                         and rsd.diet_canonical_id = dt.canonical_id))
                                               else (c.is_recipe and exists (select 1
                                                                             from diet_tags s
                                                                                      join recipe_tags rt
                                                                                           on rt.recipe_id = c.dish_id
                                                                                               and rt.tag_id = s.tag_id
                                                                             where s.root_id = dt.tag_id))
                                                   or (not c.is_recipe and exists (select 1
                                                                                   from diet_tags s
                                                                                            join recipe_suggestion_tags rst
                                                                                                 on rst.recipe_suggestion_id = c.dish_id
                                                                                                     and rst.tag_id = s.tag_id
                                                                                   where s.root_id = dt.tag_id))
                    end))),

     -- Grouped on `dish_key`, so a dish reached through two different course
     -- keys is ONE candidate whose evidence adds up rather than two competing
     -- for the slot.
     ranked as (select p.course_type,
                       k.dish_key,
                       k.is_recipe,
                       k.dish_id,
                       k.name,
                       k.name_en,
                       k.description,
                       k.short_description,
                       k.difficulty,
                       k.total_time_minutes,
                       k.image,
                       array_agg(distinct p.menu_id)                as menu_ids,
                       sum(p.saved_count)::integer                  as pair_saves,
                       row_number() over (
                           partition by p.course_type
                           order by
                               -- A menu built AROUND the base is a better answer
                               -- than one that serves it alongside something else.
                               bool_or(p.built_around) desc,
                               -- How many people KEPT a meal with this pairing.
                               -- Deliberately ahead of the menu count: a menu is
                               -- created by a save, so every menu carries at
                               -- least one, and counting menus would rank a dish
                               -- in two menus saved once each above one in a
                               -- single menu saved forty times.
                               sum(p.saved_count) desc,
                               count(distinct p.menu_id) desc,
                               -- Difficulty ORDERS, never narrows — the rule
                               -- `find_recipes` settled on. A hard base would
                               -- otherwise empty an already small pool.
                               difficulty_preference_rank(k.difficulty, p_difficulty),
                               k.name
                           )::integer                               as pair_rank
                from keep k
                         join partner p on p.course_key = k.course_key
                group by p.course_type, k.dish_key, k.is_recipe, k.dish_id, k.name,
                         k.name_en, k.description, k.short_description, k.difficulty,
                         k.total_time_minutes, k.image)

select rk.course_type,
       rk.pair_rank,
       rk.dish_key,
       rk.is_recipe,
       rk.dish_id,
       rk.name,
       rk.name_en,
       coalesce(rk.description, ''),
       rk.short_description,
       rk.difficulty,
       rk.total_time_minutes,
       rk.image,
       -- Built only for the rows that survived the cut, so a pruned candidate
       -- costs no aggregate at all.
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                     from recipe_ingredients ri
                              join ingredients i on i.id = ri.ingredient_id
                     where ri.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                 from recipe_suggestion_ingredients rsi
                          join ingredients i on i.id = rsi.ingredient_id
                 where rsi.recipe_suggestion_id = rk.dish_id) end,
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                     from recipe_tags rt
                              join tags t on t.id = rt.tag_id
                     where rt.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                 from recipe_suggestion_tags rst
                          join tags t on t.id = rst.tag_id
                 where rst.recipe_suggestion_id = rk.dish_id) end,
       rk.menu_ids,
       rk.pair_saves
from ranked rk
where rk.pair_rank <= greatest(p_per_course, 1);
$function$;

comment on function public.menu_pairings_for_recipe(uuid, text[], integer, text[], uuid[], uuid[], text[], text) is
    'Dishes people have already paired with a recipe, per course slot, ranked by how many saved meals hold the pairing. Read by the compose service as the SERVICE ROLE, so the visibility rule is in the WHERE clause rather than left to RLS — see 20260822000001.';

-- No grant. The compose service is the only caller and reaches it as the service
-- role; there is no client surface, and a client calling it would run it under
-- RLS, which this body already restates.
revoke all on function public.menu_pairings_for_recipe(uuid, text[], integer, text[], uuid[], uuid[], text[], text) from public;

-- The pairing walk is menu -> its other courses, which `idx_menu_courses_menu_id`
-- serves, and key -> menus, which `idx_menu_courses_dish_key` (20260821000006)
-- serves. Nothing new is needed.

notify pgrst, 'reload schema';
