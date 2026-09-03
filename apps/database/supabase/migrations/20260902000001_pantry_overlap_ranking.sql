------------------------------------------------------------------------------
-- Overlap ranking: what can I cook from what I already have
------------------------------------------------------------------------------
--
-- Every ingredient path in this database is a conjunctive filter — a dish
-- qualifies only if it contains EVERY id passed in. That is correct for the
-- picker, where somebody names two or three things and means "both". Point an
-- inventory at it and it inverts: the more complete the list, the fewer results,
-- and the failure is an empty feed that reads as a broken catalogue.
--
-- Measured against the dev catalogue on 2026-09-02, with a 26-item fridge fed in
-- MOST-GENEROUS order (the catalogue's most-used ingredients first, so each
-- addition is as survivable as it can be):
--
--   1 item  (salt)     100 rows      5 items (+ flour)    0 rows
--   2 items (+ garlic)  53 rows      8 items (+ olive oil) 0 rows
--   3 items (+ onion)   29 rows     15 items              0 rows
--   4 items (+ egg)      2 rows     26 items              0 rows
--
-- It reaches zero at FIVE and never recovers. Adding butter, tomato or carrot to
-- your fridge cannot help; it can only hurt. That is the trapdoor
-- `20260830000002` described from the picker's side and routed around rather
-- than closed.
--
-- The same fridge through `p_pantry`, on the same catalogue, same day:
--
--   1  Pan de Mallorca      have 3, buy 1   Yeast
--   2  Toum                 have 1, buy 1   Lemon Juice
--   3  Andalusian Gazpacho  have 4, buy 2   Green Bell Pepper, White Bread
--   4  Cotoletta            have 3, buy 2   Ghee, Panko
--   …
--
-- Note what that list still gets wrong, because it is the honest limit of this
-- change: Japanese Curry asks for "Skinless Chicken Thighs" and Katsu for
-- "Chicken Breast" while the fridge holds "Chicken". Those are separate
-- ingredient rows with no alias between them, so the closure below cannot join
-- them and does not pretend to. That is a catalogue job — see the end of this
-- header.
--
-- ## What this adds, and what it deliberately leaves alone
--
-- `p_pantry uuid[]` — a RANKING input. Nothing is excluded by it, no row is
-- added or removed, and the three result-set columns (`total_recipes`,
-- `total_suggestions`, `facets`) are untouched. It only changes the order, and
-- names the gap.
--
-- `ingredients` KEEPS its AND-all semantics. Three live callers rely on it as a
-- filter and one of them would break silently:
--
--   * the client's search screen sizes its "the catalogue is exhausted, start
--     generating" trigger off a SHORT PAGE (`getNextPageParam` in
--     `use-find-recipes`). An overlap filter returns the whole catalogue ranked,
--     every page is full, and the app quietly stops generating dishes around the
--     user's ingredients — a behaviour change that costs money in the direction
--     nobody would look;
--   * `use-suggestion-regeneration` passes exactly ONE id and reads a hit as
--     "another dish built on the same thing". Under overlap a miss returns
--     everything, and it would commit an unrelated dish instead of generating;
--   * chat's stage 1c (`findCatalogueRecipes`) answers "what can I make with
--     chicken and rice?" by intersection.
--
-- So the two live side by side, exactly as `MEAL_PLANNING_REVIEW` argued. What
-- has changed since that review is the SECOND half of the fix below — the AND
-- filter was not only narrow, it was matching the wrong thing.
--
-- ## The ranking: fewest missing first, most used as the tiebreak
--
-- "Uses the most of what I have" and "needs the fewest things I don't" are
-- different orders, and they diverge because dishes differ in size. Measured on
-- the same 26-item fridge, the top of each:
--
--   fewest missing        Pan de Mallorca (have 3, buy 1) · Toum (1, 1) ·
--                         Andalusian Gazpacho (4, 2)
--   most used             Palak Paneer (have 5, buy 6) · Gazpacho (4, 2) ·
--                         Mapo Tofu (4, 5) · Chili con Carne (4, 9)
--
-- The second column is a shopping list, not dinner. So the primary key is
-- `pantry_missing` ascending.
--
-- Two degenerate cases that pure missing-ascending gets wrong, and one clause
-- closes both. A dish built entirely of staples scores (have 0, missing 0) and
-- would TOP the feed while using nothing you own; a two-ingredient dish you have
-- neither half of scores missing 2 and outranks a twelve-ingredient dish you are
-- one item short of. Both are dishes your fridge contributed NOTHING to, so
-- `(pantry_have = 0)` sorts last, ahead of everything else:
--
--   (pantry_have = 0), pantry_missing asc, pantry_have desc
--
-- Read it as: dishes your fridge reaches, fewest-to-buy first, ties broken by
-- how much of your fridge they use; then everything else, ordered as before.
--
-- Note `pantry_have desc` and coverage (`have / (have + missing)`) are the SAME
-- order inside a fixed `missing` tier — coverage is monotonic in `have` once the
-- denominator's other half is fixed — so the simpler integer is used. This is
-- also why there is no weighted score: a weight would be a fitted constant with
-- no distribution to fit it against and no `calibrate` target to fit it with,
-- and it could not be printed on a card. A lexicographic order is a stated
-- policy, like `TIME_BAND_MAX_MINUTES`, and every key in it is a number the
-- reader can be shown.
--
-- ## Where it sits in the ORDER BY, and why it is inert without a pantry
--
-- Below `source` and below `difficulty_preference_rank`, above `favourite_count`.
-- Skill level is a standing stated preference and the same argument
-- `20260807000001` made for putting it over a like count applies here: a hard
-- dish should not outrank an easy one for a beginner just for being cookable.
-- The fridge goes above the like count because it is what THIS reader said about
-- TONIGHT, where a like count is inferred taste about everybody. With no
-- difficulty preference set, `difficulty_preference_rank` returns 0 for every
-- row and the pantry becomes the primary key — which is the right answer for the
-- reader who has told the app nothing except what is in the fridge.
--
-- With an empty `p_pantry` all three keys are constant across every row, so the
-- ORDER BY is byte-identical to `20260823000001`'s. That is by construction,
-- not by luck: the stats CTEs produce no rows at all when the pantry is empty
-- (`not pantry_empty` in their WHERE), so every row coalesces to 0/0. Getting
-- this wrong is the one change here that would reach every existing surface —
-- computing `missing` as "everything, since you have nothing" would order the
-- whole catalogue by ingredient count for callers that pass no pantry at all.
--
-- ## The ranking must decide the TRUNCATION, not just the final sort
--
-- `candidate_recipes` cuts the pool to `limit_count + p_offset` before the
-- expensive per-row aggregates, ordered by difficulty then NAME. A pantry order
-- applied only at the end would therefore reorder the alphabetically-first
-- twelve dishes and nothing else. The keys are added to that ORDER BY too.
--
-- Deliberately NOT added there: `favourite_count`. The truncation has disagreed
-- with the final sort about likes since `20260807000001`, so page one is the
-- alphabetically-first slice re-sorted by likes rather than the most-liked
-- slice. That is a real defect and it is not this migration's — fixing it would
-- change which twelve dishes every existing caller sees, with no pantry
-- involved.
--
-- ## Staples
--
-- If salt, water, oil and pepper count as missing, every dish needs a shopping
-- trip. Measured over the 40 base recipes: staples are 17.7% of all ingredient
-- rows and are spread 0 to 4 per dish (mean 1.53, ten dishes carry none, six
-- carry three or more) against a mean dish size of 8.6. A near-constant penalty
-- would be harmless — a constant cannot reorder anything — but a 0-to-4 swing
-- unrelated to the fridge is most of the signal this ranking has. On a 22-item
-- fridge with no staples listed (which is what an inventory actually looks like:
-- nobody photographs the salt), the exemption is the difference between telling
-- somebody Aglio e Olio needs two things and telling them it needs four.
--
-- Staples are excluded from BOTH counts, not just from `missing`. A user who
-- does list salt would otherwise have it credited to `have` on one side while it
-- was exempt on the other, and `have + missing` would stop being the dish's
-- pantry-relevant size.
--
-- ### Why a table of canonical ids
--
-- Same reasons `near_miss_swappable_properties` and `dietary_rules` are tables:
-- it is reference data, it is the whole of an assumption made ON the reader's
-- behalf, and widening it should be an INSERT with a measurement behind it
-- rather than a migration that rewrites a function.
--
-- Keyed on `canonical_id`, not on `ingredients.id`, and that is forced: ingredient
-- uuids differ between the local stack and the dev project, so a uuid-keyed seed
-- could not be written in a migration at all. It is also the identity rule the
-- rest of the schema already uses.
--
-- The two alternatives were measured and rejected:
--
--   * **By category.** `categories` is far too coarse and, on this catalogue,
--     wrong: Salt sits in `herbs_spices` beside saffron, Water in `vegetables`,
--     Bay Leaf in `mushrooms`, Cornstarch in `noodles`.
--   * **By `use_count`.** That column counts CATALOGUE coverage, and its own
--     migration says not to present it. Deciding what a person is assumed to own
--     from how often this catalogue happens to mention it is presenting it, and
--     a saffron-heavy catalogue would make saffron a staple.
--
-- ### What is on the list, and what is pointedly not
--
-- Salt, plain sugar, water, black and white pepper, and neutral cooking oil —
-- things nobody makes a trip for and no dish is about. Not butter or flour
-- (plenty of kitchens have neither, and butter is perishable), not garlic or
-- onion (perishable, and frequently the point), not brown or palm sugar, not
-- sesame, chilli, coconut or mustard oil, and explicitly NOT peanut oil: it is an
-- allergen, and assuming somebody has one is worse than assuming they do not.
--
-- Olive oil and extra-virgin olive oil are the weakest two and are here
-- knowingly, the way `refined_sugar` is in `near_miss_swappable_properties`.
-- Take them out if a dish whose whole point is the oil starts reading as free.
--
-- Bare `pepper` is deliberately absent even though `black_pepper` is present,
-- and it is the one omission that costs something real: the local seed holds a
-- `Pepper` row that plainly means the seasoning (Duck à l'Orange lists "salt,
-- pepper"), so it is reported as something to buy. The word will not settle it
-- either way — the dev catalogue holds `bell_pepper`, `green_pepper`,
-- `red_bell_pepper`, `aleppo_pepper`, `chili_pepper` and `jalape_o_pepper`
-- beside it — and the two mistakes are not symmetric: telling somebody to buy
-- pepper they own is a shrug, and silently crediting them with a capsicum they
-- do not is the failure this whole list exists to avoid. Same instinct as
-- `near_miss_swappable_properties`, and the same remedy if it ever matters:
-- merge the ambiguous row, do not widen the rule.
--
-- Which is also why this is a list of exact canonical ids and never a pattern
-- over the name. `like '%pepper%'` would take the entire capsicum family with it.
--
-- ## Identity: an id is not a thing
--
-- A pantry matching on exact ids misses a dish that spells its ingredient
-- differently. `ingredient_aliases` already knows the answer and nothing on the
-- READ path was asking it — alias resolution (`20260823000003`,
-- `resolveIngredientIds`) runs on the WRITE path and on chat's name→id lookup,
-- both of which resolve a NAME. The picker hands over an ID, and two ingredient
-- ROWS that are the same thing stay two ids.
--
-- Eleven such pairs exist on the dev catalogue today. Measured 2026-09-02, as
-- dishes reachable by picking the left-hand row, before and after the closure:
--
--   All Purpose Flour  ->  Flour           1  ->  76
--   Toasted Sesame Oil ->  Sesame Oil      2  ->  27
--   Red Pepper Flakes  ->  Chili Flakes    0  ->   9
--   Risotto Rice       ->  Arborio Rice    0  ->   7
--   Minced Pork        ->  Ground Pork     1  ->   7
--   String Beans       ->  Green Beans     0  ->   4
--
-- Three of those six reach NOTHING today, which is the picker trapdoor exactly:
-- the row is offered, it is a real ingredient, and choosing it empties the feed.
--
-- `ingredient_identity_ids` closes each requested id over that relation, and it
-- is applied to `ingredients`, `blacklist` and `p_pantry` alike — because a
-- blacklist that lets "Minced Pork" through because the reader excluded "Ground
-- Pork" is the same defect pointing at somebody's dinner.
--
-- ### Why the AND count is computed per REQUESTED id, not over the flat closure
--
-- The obvious mistake here is to expand `ingredients` into one wider array and
-- leave the count test alone. That breaks it: expanding two requested ids into
-- four would demand four distinct matches and make the filter HARDER, which is
-- the exact opposite of the intent. The rule is "for every requested id, at
-- least one member of its identity group is present", and it is counted off the
-- RAW argument — the same construction, and the same fail-closed reason, as
-- `requested_tag_count`.
--
-- Expansion is strictly WIDENING for `ingredients` (a request can only match
-- more) and strictly NARROWING for `blacklist` (an exclusion can only catch
-- more), so no existing caller loses a result it was entitled to and no
-- blacklist leaks. Chat's stage 1c is unaffected: `containsRequestedIngredient`
-- gates the VECTOR results, not the `find_recipes` rows, which are filtered in
-- SQL.
--
-- ### `parent_id` is NOT used for this
--
-- It is populated on 5 of 1041 rows, and it means "is a kind of" rather than "is
-- the same as": Ghee→Butter, Quail Egg→Egg. Folding a specialisation into an
-- identity would answer a request for butter with a ghee dish and vice versa.
--
-- ## What it costs, and how it grows
--
-- Measured on a synthetic local catalogue (9 ingredients per dish, no other
-- filters, `limit_count` 12, 30-item pantry, mean of five warm calls):
--
--   base recipes      no pantry     with pantry
--   1,000               16 ms          36 ms
--   5,000               46 ms          86 ms
--   20,000             155 ms         258 ms
--
-- Both columns are linear in the catalogue and the pantry is a constant factor
-- of roughly 1.7 on top. It does not change the complexity class, because this
-- function was ALREADY linear before it: `family_picks`, `total_recipes` and
-- `facet_counts` each walk the whole matching set, which is why the no-pantry
-- column climbs the same way. The ~260 ms at 20,000 dishes is that design's
-- ceiling, not this one's — but it is a real ceiling and the pantry brings it
-- closer.
--
-- The new work is one hash-aggregated pass over `recipe_ingredients` restricted
-- to the matching set, deliberately written that way rather than as two
-- correlated subqueries per row: the correlated form is
-- (recipes × ingredients-per-dish × pantry-size) comparisons and would grow with
-- the size of somebody's fridge as well as with the catalogue. This one does
-- not — a 30-item pantry and a 5-item pantry cost the same.
--
-- `ingredient_identity_ids` itself is not the cost. It is 0.11 ms for 30 ids
-- against 195 alias rows, and it is called once per array plus once per
-- requested ingredient (at most five, from the picker's own cap).
--
-- ### What this does NOT fix
--
-- Most of the picker trapdoor is not an alias problem. Of 1041 ingredients only
-- 475 are used by anything; the unused ones are mostly rows like "Grilled
-- Tomatoes" and "Ripe Tomato" with no alias linking them to Tomato, so picking
-- one still empties an AND search. What overlap ranking does for those is make
-- them HARMLESS rather than fatal — a bad pick contributes nothing to the score
-- instead of emptying the result. Closing the rest is a catalogue job
-- (`dedupe-ingredients`, `merge-spelling-variants`), not a query one.

------------------------------------------------------------------------------
-- pantry_staples
------------------------------------------------------------------------------

create table if not exists pantry_staples
(
    canonical_id text primary key
);

comment on table pantry_staples is
    'Ingredients assumed present in any kitchen, exempt from BOTH sides of the pantry overlap arithmetic. Reference data — widening it is an INSERT plus a re-measurement. See 20260902000001.';

insert into pantry_staples (canonical_id)
values
    -- Salt, in the spellings the generator actually emits.
    ('salt'),
    ('table_salt'),
    ('sea_salt'),
    ('kosher_salt'),
    ('fine_sea_salt'),
    ('coarse_sea_salt'),
    -- Water, including the preparation states. "Warm water" is water.
    ('water'),
    ('warm_water'),
    ('lukewarm_water'),
    ('cold_water'),
    ('hot_water'),
    ('boiling_water'),
    ('ice_water'),
    -- Pepper. Named exactly; see the header on why bare `pepper` is absent.
    ('black_pepper'),
    ('white_pepper'),
    ('ground_black_pepper'),
    ('freshly_ground_black_pepper'),
    ('cracked_black_pepper'),
    ('black_peppercorn'),
    ('white_peppercorn'),
    -- Plain sugar only. Brown, powdered and palm sugar are trips to a shop.
    ('sugar'),
    ('white_sugar'),
    ('granulated_sugar'),
    -- The bottle of frying oil, under its several names.
    ('oil'),
    ('cooking_oil'),
    ('vegetable_oil'),
    ('neutral_oil'),
    ('canola_oil'),
    ('rapeseed_oil'),
    ('sunflower_oil'),
    -- The weakest two on the list, kept knowingly.
    ('olive_oil'),
    ('extra_virgin_olive_oil')
on conflict (canonical_id) do nothing;

alter table pantry_staples enable row level security;

-- Read-only to everybody, like `near_miss_swappable_properties`. A client that
-- wants to explain why salt is not on its shopping list can read the list.
drop policy if exists public_read on pantry_staples;
create policy public_read on pantry_staples for select
    using (true);

------------------------------------------------------------------------------
-- ingredient_identity_ids
------------------------------------------------------------------------------
--
-- Every ingredient row that is the same THING as one of the ids passed in,
-- including the ids themselves.
--
-- The relation is symmetric — `ingredient_aliases` says "this NAME means that
-- INGREDIENT", so an ingredient ROW whose canonical name is an alias of another
-- row is a duplicate of it, in both directions — and it is closed transitively
-- because chains exist: "crushed red pepper" → Red Pepper Flakes and "red pepper
-- flakes" → Chili Flakes, which makes all three one ingredient.
--
-- `edges` only produces a row where an alias's canonical form is ALSO an
-- ingredient row. An alias like `green onion → Scallion` with no "Green Onion"
-- row of its own contributes nothing, correctly: there is no second id to unify.
--
-- UNION rather than UNION ALL in the recursive term is what terminates the walk
-- on a cycle; the edge set is symmetric, so every edge is a two-cycle and this
-- is load-bearing rather than tidy.
--
-- STABLE and not SECURITY DEFINER: it reads `ingredients` and
-- `ingredient_aliases`, both world-readable, so an invoker-rights function sees
-- the same rows for everybody and adds no visibility surface of its own.

create or replace function public.ingredient_identity_ids(p_ids uuid[])
    returns uuid[]
    language sql
    stable
    set search_path to 'public'
as
$function$
with recursive edges as (select i.id           as a,
                                a.ingredient_id as b
                         from ingredient_aliases a
                                  join ingredients i on i.canonical_id = a.alias_canonical_id
                         union all
                         select a.ingredient_id,
                                i.id
                         from ingredient_aliases a
                                  join ingredients i on i.canonical_id = a.alias_canonical_id),
               closure as (select distinct t.id
                           from unnest(coalesce(p_ids, '{}'::uuid[])) as t(id)
                           union
                           select e.b
                           from closure c
                                    join edges e on e.a = c.id)
select coalesce(array_agg(distinct id), '{}'::uuid[])
from closure;
$function$;

comment on function public.ingredient_identity_ids(uuid[]) is
    'Each id plus every ingredient row that is the same thing, closed over ingredient_aliases in both directions. See 20260902000001.';

-- `find_near_miss_recipes` is SECURITY INVOKER and calls this as the client.
grant execute on function public.ingredient_identity_ids(uuid[]) to anon, authenticated;

------------------------------------------------------------------------------
-- find_recipes
------------------------------------------------------------------------------
--
-- The function is dropped first so the composite type has no dependency to
-- argue about, then the three attributes are appended and it is recreated — the
-- same dance as 20260812000004, 20260815000003 and 20260823000001.
--
-- `add attribute` APPENDS, so the new columns are last and in this order. The
-- client reads them by name and defends against their absence, so a stack that
-- has not run this migration keeps working.
--
-- `p_pantry` is likewise the LAST parameter, which keeps every existing
-- positional call valid on its default.

drop function if exists public.find_recipes(text, uuid[], uuid[], uuid[], integer, integer);

-- `alter type … add attribute` has no IF NOT EXISTS, and the earlier migrations
-- that append to this type are therefore one-shot: re-running one raises
-- "column already exists" AFTER it has already dropped the function, leaving
-- the database with no `find_recipes` at all. Guarded here so a re-run is a
-- no-op rather than an outage, which is the state anyone iterating on this
-- locally will otherwise reach.
do $$
    declare
        att record;
    begin
        for att in
            select *
            from (values ('pantry_have', 'integer'),
                         ('pantry_missing', 'integer'),
                         ('pantry_missing_ingredients', 'jsonb')) as v(name, type)
            loop
                if not exists (select 1
                               from pg_attribute a
                               where a.attrelid = 'find_recipes_result'::regclass
                                 and a.attname = att.name
                                 and not a.attisdropped) then
                    execute format('alter type find_recipes_result add attribute %I %s',
                                   att.name, att.type);
                end if;
            end loop;
    end;
$$;

CREATE OR REPLACE FUNCTION public.find_recipes(p_difficulty text DEFAULT NULL::text, ingredients uuid[] DEFAULT ARRAY[]::uuid[], tags uuid[] DEFAULT ARRAY[]::uuid[], blacklist uuid[] DEFAULT ARRAY[]::uuid[], limit_count integer DEFAULT 10, p_offset integer DEFAULT 0, p_pantry uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS SETOF find_recipes_result
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
difficulty_filter text := null;
  -- Counted off the raw argument, not off the resolved `requested` CTE below,
  -- so an id that matches no tag row makes the filter unsatisfiable instead of
  -- being quietly ignored. For a restriction, failing closed is the only safe
  -- direction.
  requested_tag_count integer := (select count(distinct t) from unnest(tags) as t);
  -- THE EDIT (20260902000001). Same construction as the tag count above and for
  -- the same reason: the requirement is one satisfied REQUEST, not one matched
  -- id, so the identity closure below must not be allowed to inflate it.
  requested_ingredient_count integer := (select count(distinct t) from unnest(ingredients) as t);
  -- Flat closures. Both are membership tests ("does this dish contain any of
  -- them"), so unlike the ingredient filter they need no per-request grouping.
  blacklist_ids uuid[] := ingredient_identity_ids(blacklist);
  pantry_ids uuid[] := ingredient_identity_ids(p_pantry);
  -- Resolved once. Every pantry expression below is guarded on it, which is what
  -- makes a call with no pantry produce the ordering this function had before.
  pantry_empty boolean := coalesce(array_length(pantry_ids, 1), 0) = 0;
begin
  -- Normalize difficulty preference
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
  /* -------------------------------------------------
   * 0a. Each requested tag, resolved, and how it must be satisfied: a derivable
   * diet is answered from the ingredients, everything else from the tags the
   * row carries.
   * ------------------------------------------------- */
  requested as (
    select distinct
      t.id,
      t.canonical_id,
      (dr.diet_canonical_id is not null) as is_derived_diet
    from unnest(tags) as req(id)
    join tags t on t.id = req.id
    left join dietary_rules dr
      on t.type = 'dietary'
     and dr.diet_canonical_id = t.canonical_id
  ),

  /* -------------------------------------------------
   * 0b. Subtree expansion for the tag-matched ones (see 20260803000002).
   * ------------------------------------------------- */
  requested_tags as (
    select s.root_id, s.tag_id
    from tag_subtree(array(select id from requested where not is_derived_diet)) s
  ),

  /* -------------------------------------------------
   * 0c. THE EDIT (20260902000001). One row per REQUESTED ingredient, carrying
   * every id that is the same thing. The dish has to satisfy each row, not each
   * id — see the header on why flattening this into one wide array would make
   * the filter stricter rather than looser.
   * ------------------------------------------------- */
  requested_ingredients as (
    select distinct req.id as request_id,
           ingredient_identity_ids(array [req.id]) as group_ids
    from unnest(ingredients) as req(id)
  ),

  /* -------------------------------------------------
   * 1a. Every recipe passing the hard filters — variants INCLUDED.
   * ------------------------------------------------- */
  matching_recipes as (
    select
      r.id,
      r.name,
      r.description,
      r.short_description,
      r.image,
      r.difficulty::text as difficulty,
      r.favourite_count,
      r.identity_cuisine,
      -- The time band's only input.
      r.total_time_minutes,
      -- Provenance, carried alongside the difficulty pick below because a
      -- family can in principle mix an imported base with generated variants.
      r.origin,
      -- A dish's family: its base's id, or its own when it IS the base.
      coalesce(r.base_recipe_id, r.id) as family_id,
      r.base_recipe_id
    from recipes r
    where
      -- THE EDIT (20260815000006). The shared catalogue, plus this caller's own
      -- recipes. First in the WHERE because it is the cheapest predicate here
      -- and the only one that is about who is asking rather than what they
      -- asked for.
      recipe_is_visible(r.created_by)
      and (
        requested_ingredient_count = 0
        or (
          -- THE EDIT (20260902000001). Was a single count over
          -- `ri.ingredient_id = any (ingredients)`; now one satisfied request
          -- per requested id, which is what makes "All Purpose Flour" find the
          -- 75 dishes that list "Flour".
          select count(*)
          from requested_ingredients q
          where exists (
            select 1
            from recipe_ingredients ri
            where ri.recipe_id = r.id
              and ri.ingredient_id = any (q.group_ids)
          )
        ) = requested_ingredient_count
      )
      and (
        coalesce(array_length(blacklist_ids, 1), 0) = 0
        or not exists (
          select 1
          from recipe_ingredients rib
          where rib.recipe_id = r.id
            -- THE EDIT (20260902000001). Closed over the alias identity, so
            -- excluding Ground Pork also excludes the Minced Pork row.
            and rib.ingredient_id = any (blacklist_ids)
        )
      )
      and (
        requested_tag_count = 0
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_dietary rd
                where rd.recipe_id = r.id
                  and rd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_tags rt
                  on rt.recipe_id = r.id
                 and rt.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 1a-ii. THE EDIT (20260902000001). How much of this dish the reader already
   * has, and how much of it they do not.
   *
   * One grouped pass over the junction table for the whole matching set, rather
   * than two correlated subqueries per row: the per-row form is
   * recipes × pantry_size comparisons and this is linear in
   * `recipe_ingredients`, which is what keeps it flat as the catalogue grows.
   *
   * Staples are dropped from the input, so they count on NEITHER side. A dish
   * with nothing but staples produces no row here at all and coalesces to 0/0 —
   * which the `(pantry_have = 0)` key below then sorts to the tail, where a
   * dish the fridge did not reach belongs.
   *
   * `not pantry_empty` is what makes the whole feature inert for a caller that
   * passes no pantry: with no rows here, every recipe coalesces to 0/0 and the
   * three ordering keys are constant.
   * ------------------------------------------------- */
  pantry_recipe_stats as (
    select ri.recipe_id,
           count(*) filter (where ri.ingredient_id = any (pantry_ids))::integer       as have,
           count(*) filter (where not (ri.ingredient_id = any (pantry_ids)))::integer as missing
    from matching_recipes m
    join recipe_ingredients ri on ri.recipe_id = m.id
    join ingredients i on i.id = ri.ingredient_id
    where not pantry_empty
      and not exists (
        select 1 from pantry_staples s where s.canonical_id = i.canonical_id
      )
    group by ri.recipe_id
  ),

  /* -------------------------------------------------
   * 1b. One row per dish — the copy closest to the requested difficulty.
   *
   * Note the band travels WITH the difficulty pick rather than being read
   * separately: an easy and a hard copy of one dish have different times, and
   * the pill has to describe the copy actually being shown.
   *
   * The pantry numbers travel with it for the same reason — the two copies of a
   * dish can list different ingredients, so the counts have to describe the copy
   * actually being shown. They deliberately do NOT participate in choosing it:
   * which rung of a family a reader gets is a question about their skill, and
   * letting the fridge answer it would hand a beginner the hard version for
   * owning a spice.
   * ------------------------------------------------- */
  family_picks as (
    select distinct on (m.family_id)
      m.id,
      m.name,
      m.description,
      m.short_description,
      m.image,
      m.difficulty,
      m.favourite_count,
      m.identity_cuisine,
      m.total_time_minutes,
      -- Of the copy actually being shown, for the same reason the band is.
      m.origin,
      coalesce(ps.have, 0) as pantry_have,
      coalesce(ps.missing, 0) as pantry_missing
    from matching_recipes m
    left join pantry_recipe_stats ps on ps.recipe_id = m.id
    order by
      m.family_id,
      difficulty_preference_rank(m.difficulty, difficulty_filter),
      -- Equal distance: prefer the base, which carries the likes and the image.
      (m.base_recipe_id is not null),
      m.id
  ),

  /* -------------------------------------------------
   * 1c. Difficulty orders rather than narrows.
   * ------------------------------------------------- */
  candidate_recipes as (
    select *
    from family_picks f
    order by
      difficulty_preference_rank(f.difficulty, difficulty_filter),
      -- THE EDIT (20260902000001). The pantry keys are here as well as in the
      -- final ORDER BY, and they have to be: this LIMIT is what decides which
      -- dishes reach the page at all, so a pantry order applied only at the end
      -- would reorder the alphabetically-first twelve and nothing else.
      -- Constant when no pantry is passed, so this reduces to the previous
      -- (difficulty, name) truncation exactly.
      (f.pantry_have = 0),
      f.pantry_missing,
      f.pantry_have desc,
      f.name
    -- Must cover the whole requested WINDOW, not just its length. This is a
    -- performance guard — `recipe_rows` below runs two jsonb aggregates per row,
    -- so the pool is cut before that rather than after — and it was written when
    -- there was only ever one page, where `limit_count` was the window.
    --
    -- With an offset it silently truncated the catalogue: at limit 12 offset 12
    -- this produced the FIRST 12 recipes, the final OFFSET then skipped all of
    -- them, and page two opened on suggestions while recipes 13+ were
    -- unreachable at any offset. Recipes must be exhausted before a suggestion
    -- is shown, and that is exactly what broke.
    limit limit_count + greatest(p_offset, 0)
  ),

  /* -------------------------------------------------
   * 2. Recipes with relations
   * ------------------------------------------------- */
  recipe_rows as (
    select
      c.id,
      c.name,
      c.description,
      c.short_description,
      c.image,
      c.difficulty,
      c.favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_ingredients ri on ri.ingredient_id = i.id
        where ri.recipe_id = c.id
      ), '[]'::jsonb) as ingredients,
      -- Display tags, not raw recipe_tags: a dietary chip now says what the
      -- ingredients say, which is what the filter above answered from.
      -- `type` included so the client can single out the cuisine tag (or any
      -- other type) without name-matching.
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_display_tags dt
        where dt.recipe_id = c.id
      ), '[]'::jsonb) as tags,
      'recipe'::text as source,
      c.total_time_minutes,
      c.origin,
      -- LAST, matching the attributes appended to the result type.
      c.pantry_have,
      c.pantry_missing,
      -- What to buy, named. The client cannot compute this itself — it does not
      -- hold the staples list or the alias identity groups, so a client-side
      -- difference against its own pantry would disagree with the count beside
      -- it. Only over the page, so it costs one more subquery on at most
      -- `limit_count + p_offset` rows.
      case
        when pantry_empty then '[]'::jsonb
        else coalesce((
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name)
            order by i.name
          )
          from ingredients i
          join recipe_ingredients ri on ri.ingredient_id = i.id
          where ri.recipe_id = c.id
            and not (i.id = any (pantry_ids))
            and not exists (
              select 1 from pantry_staples s where s.canonical_id = i.canonical_id
            )
        ), '[]'::jsonb)
      end as pantry_missing_ingredients
    from candidate_recipes c
  ),

  /* -------------------------------------------------
   * 3. Suggestion candidates (fallback)
   * ------------------------------------------------- */
  suggestion_candidates as (
    select
      rs.id,
      rs.name,
      rs.description,
      rs.difficulty::text as difficulty,
      -- The generator's estimate. NULL on anything written before
      -- 20260812000004, which the client renders as no pill.
      rs.total_time_minutes
    from recipe_suggestions rs
    where
      -- A promoted dish hides its own stale suggestion row. Keyed on
      -- (canonical name, identity cuisine) since 20260812000003: on the name
      -- alone, a promoted Turkish Manti RECIPE permanently hid a Kazakh Manti
      -- SUGGESTION from the feed, which would have undone the write-side split
      -- one layer further out.
      --
      -- `not exists`, not `not in`: `identity_cuisine` is nullable, and a single
      -- NULL anywhere in a `not in` subquery makes the whole predicate NULL and
      -- silently suppresses EVERY suggestion.
      --
      -- Null on either side merges, matching the write path — it is "unknown",
      -- not a distinct identity, so an un-backfilled row keeps behaving exactly
      -- as it does today. Ancestor-related cuisines are deliberately NOT
      -- resolved here: that needs a recursive subtree walk per row, and the
      -- write path already collapses those before two rows can exist.
      --
      -- Reads `family_picks`, which is owner-scoped — so one user's import can
      -- no longer hide a suggestion from anybody else, and cannot hide one from
      -- its own owner either, since for them it IS the same dish.
      --
      -- THE EDIT (20260823000001). It used to read `candidate_recipes`, which is
      -- `family_picks` TRUNCATED to `limit_count + p_offset` — so whether a
      -- suggestion was suppressed depended on which PAGE was being asked for. A
      -- recipe outside the current window could not hide its own suggestion, and
      -- the same dish came back twice: once as a recipe with an illustration,
      -- once as an idea offering to write the recipe that already exists.
      --
      -- It has not fired yet because recipes are exhausted before a suggestion
      -- is reached, which puts the whole catalogue inside the window by the time
      -- it matters. That stops being true the moment the truncation is ever
      -- loosened or the ordering changed, and the failure is silent.
      not exists (
        select 1
        from family_picks c
        where regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '_', 'g') = rs.canonical_id
          and (
            c.identity_cuisine is null
            or rs.identity_cuisine is null
            or c.identity_cuisine = rs.identity_cuisine
          )
      )
      and (
        requested_ingredient_count = 0
        or (
          -- THE EDIT (20260902000001). The recipe half's rule, applied to the
          -- suggestion half — the two must agree about what an ingredient is or
          -- one feed would hold a dish the other could not find.
          select count(*)
          from requested_ingredients q
          where exists (
            select 1
            from recipe_suggestion_ingredients rsi
            where rsi.recipe_suggestion_id = rs.id
              and rsi.ingredient_id = any (q.group_ids)
          )
        ) = requested_ingredient_count
      )
      and (
        coalesce(array_length(blacklist_ids, 1), 0) = 0
        or not exists (
          select 1
          from recipe_suggestion_ingredients rsib
          where rsib.recipe_suggestion_id = rs.id
            and rsib.ingredient_id = any (blacklist_ids)
        )
      )
      and (
        requested_tag_count = 0
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_suggestion_dietary rsd
                where rsd.recipe_suggestion_id = rs.id
                  and rsd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_suggestion_tags rst
                  on rst.recipe_suggestion_id = rs.id
                 and rst.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 3a-ii. THE EDIT (20260902000001). The recipe stats, for the ideas half.
   *
   * Suggestions are not truncated before the final ORDER BY the way recipes
   * are, so these only have to reach `suggestion_rows`.
   * ------------------------------------------------- */
  pantry_suggestion_stats as (
    select rsi.recipe_suggestion_id as suggestion_id,
           count(*) filter (where rsi.ingredient_id = any (pantry_ids))::integer       as have,
           count(*) filter (where not (rsi.ingredient_id = any (pantry_ids)))::integer as missing
    from suggestion_candidates sc
    join recipe_suggestion_ingredients rsi on rsi.recipe_suggestion_id = sc.id
    join ingredients i on i.id = rsi.ingredient_id
    where not pantry_empty
      and not exists (
        select 1 from pantry_staples s where s.canonical_id = i.canonical_id
      )
    group by rsi.recipe_suggestion_id
  ),

  /* -------------------------------------------------
   * 3b. Every dish-form tag carried by anything these filters match, counted.
   *
   * Over the WHOLE matching set, not over the page — which is the only version
   * of this worth sending. Counted off the 12 rows a page happens to contain,
   * a facet chip says "Noodles" or stays silent depending on alphabetical
   * order, and the reader is offered a narrowing that is an artefact of paging.
   *
   * Unaffected by the pantry, deliberately: it ranks, it does not filter, so
   * the matching set is the same set it was and a facet count that moved with
   * somebody's fridge would be describing the sort order.
   *
   * Dish form and not course: `course` is four slots and is a SECTION question
   * (see the client's `COURSE_SLOTS`), while dish form is ~20 shallow buckets
   * that only make sense as a filter. Read off the DISPLAY views so a chip can
   * only ever name a tag the cards under it also show.
   *
   * Both halves of the feed contribute. A cuisine whose catalogue is mostly
   * unwritten would otherwise offer chips describing the few recipes it has and
   * nothing about the ideas that make up most of the list.
   * ------------------------------------------------- */
  facet_counts as (
    select links.tag_id as id, links.tag_name as name, count(*)::integer as n
    from (
      select dt.id as tag_id, dt.name as tag_name
      from family_picks f
      join recipe_display_tags dt on dt.recipe_id = f.id
      where dt.type = 'dish_form'
      union all
      select dt.id, dt.name
      from suggestion_candidates sc
      join recipe_suggestion_display_tags dt
        on dt.recipe_suggestion_id = sc.id
      where dt.type = 'dish_form'
    ) links
    group by links.tag_id, links.tag_name
  ),

  /* -------------------------------------------------
   * 3c. The chips, ordered by how much of the result each one accounts for.
   *
   * Capped at twelve: past that a rail is a second list rather than a way
   * through the first one, and the tail is single-dish buckets that narrow to
   * exactly the row the reader can already see.
   * ------------------------------------------------- */
  facet_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', t.id, 'name', t.name, 'count', t.n)
        order by t.n desc, t.name
      ),
      '[]'::jsonb
    ) as facets
    from (
      select fc.id, fc.name, fc.n
      from facet_counts fc
      order by fc.n desc, fc.name
      limit 12
    ) t
  ),

  /* -------------------------------------------------
   * 4. Suggestions with relations
   * ------------------------------------------------- */
  suggestion_rows as (
    select
      sc.id,
      sc.name,
      sc.description,
      -- Already a single generated line: it is its own short form.
      sc.description as short_description,
      null::text as image,
      sc.difficulty,
      0 as favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_suggestion_ingredients rsi
          on rsi.ingredient_id = i.id
        where rsi.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as ingredients,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_suggestion_display_tags dt
        where dt.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as tags,
      'suggestion'::text as source,
      sc.total_time_minutes,
      -- NULL because a suggestion has no provenance: nobody has written the
      -- dish down yet. In the same position as `recipe_rows` above — the union
      -- below matches on position, not on name.
      null::text as origin,
      coalesce(sps.have, 0) as pantry_have,
      coalesce(sps.missing, 0) as pantry_missing,
      case
        when pantry_empty then '[]'::jsonb
        else coalesce((
          select jsonb_agg(
            jsonb_build_object('id', i.id, 'name', i.name)
            order by i.name
          )
          from ingredients i
          join recipe_suggestion_ingredients rsi
            on rsi.ingredient_id = i.id
          where rsi.recipe_suggestion_id = sc.id
            and not (i.id = any (pantry_ids))
            and not exists (
              select 1 from pantry_staples s where s.canonical_id = i.canonical_id
            )
        ), '[]'::jsonb)
      end as pantry_missing_ingredients
    from suggestion_candidates sc
    left join pantry_suggestion_stats sps on sps.suggestion_id = sc.id
  ),

  /* -------------------------------------------------
   * 5. Combine and enforce limit
   * ------------------------------------------------- */
  combined as (
    select * from recipe_rows
    union all
    select * from suggestion_rows
  )

-- Every column is alias-qualified: `ingredients` and `tags` are also parameter
-- names on this function, so a bare column list here is ambiguous.
select
  c.id,
  c.name,
  c.description,
  c.short_description,
  c.image,
  c.difficulty,
  c.favourite_count,
  c.ingredients,
  c.tags,
  c.source,
  c.total_time_minutes,
  c.origin,
  -- In `add attribute` order — the composite type appends, and a mismatch here
  -- is a per-row runtime error rather than a build failure.
  tr.total_recipes,
  ts.total_suggestions,
  fj.facets,
  c.pantry_have,
  c.pantry_missing,
  c.pantry_missing_ingredients
from combined c
-- Uncorrelated, so they are evaluated once per call and attached to every row
-- rather than recomputed per row. Repeating them across a page is the cost of
-- `setof` having no header; it is three small values against twelve rows that
-- already carry two jsonb aggregates each.
--
-- `total_recipes` counts DISHES, not rows: `family_picks` has already collapsed
-- each family to the copy closest to the requested difficulty, so a dish with
-- an easy, a medium and a hard version counts once. That is what the header
-- line means by "104 recipes".
--
-- Both are unaffected by `p_pantry`, which is the whole claim of this being a
-- ranking rather than a filter: the result set is the same size and holds the
-- same dishes, in a different order.
cross join (select count(*)::integer as total_recipes from family_picks) tr
cross join (select count(*)::integer as total_suggestions from suggestion_candidates) ts
cross join facet_json fj
-- Real recipes before suggestions, then closest-to-preference, then best fit
-- for what is in the fridge, then most liked, then by name.
order by
  case c.source when 'recipe' then 0 else 1 end,
  difficulty_preference_rank(c.difficulty, difficulty_filter),
  -- THE EDIT (20260902000001). A dish the fridge did not reach at all sorts
  -- behind every dish it did — which is what stops an all-staples dish (have 0,
  -- missing 0) and a tiny dish you have neither half of from topping a feed
  -- ordered on "fewest to buy".
  (c.pantry_have = 0),
  -- The primary pantry key: fewest things to buy. "Uses the most of what I
  -- have" is the other ranking and it is the wrong one — measured, it leads
  -- with a dish using five of your items and needing six more.
  c.pantry_missing,
  -- Ties broken by how much of the fridge the dish uses. Identical in effect to
  -- ordering by coverage, which is monotonic in this once `missing` is fixed.
  c.pantry_have desc,
  -- The only signal of "best" this schema has. Below the difficulty tier
  -- because skill level is a stated preference and a like count is inferred
  -- taste; a hard dish should not outrank an easy one for a beginner just for
  -- being popular. Now also below the pantry, on the same argument in the other
  -- direction: what this reader has in the fridge tonight beats what everybody
  -- else liked.
  --
  -- Only ever separates RECIPES: `suggestion_rows` reports 0 for every
  -- suggestion (nothing can favourite one), and they already sit in the lower
  -- source tier, so this cannot reorder them among themselves.
  c.favourite_count desc,
  c.name,
  -- Total order, which OFFSET pagination requires and the first three keys do
  -- not give: two difficulties of one dish share a name, and can tie on the
  -- preference rank too (easy and hard sit the same distance from medium). Any
  -- tie there lets a row shift between pages and be served twice or skipped.
  c.id
limit limit_count offset greatest(p_offset, 0);

end;
$function$;

comment on function public.find_recipes(text, uuid[], uuid[], uuid[], integer, integer, uuid[]) is
    'Discovery feed. Difficulty RANKS rather than filters (20260803000001); `p_pantry` ranks by how little the reader would have to buy and never excludes (20260902000001); every row carries the result-set totals and dish-form facets so the client can describe a result it has only partly loaded.';

------------------------------------------------------------------------------
-- find_near_miss_recipes: the same identity rule
------------------------------------------------------------------------------
--
-- The search screen calls this and `find_recipes` with the SAME ingredient ids,
-- side by side on one screen. If only one of them closes an id over its aliases
-- the two disagree about what an ingredient is, and the rail either offers a
-- dish the feed above it could not find or withholds one it did.
--
-- Body reproduced from `20260830000001`. Two edits, both marked in place; the
-- signature is unchanged, so this is a plain `create or replace`.
--
-- `p_exclude` is deliberately NOT closed over the identity: those are RECIPE
-- ids, not ingredient ids.

create or replace function public.find_near_miss_recipes(
    p_diets uuid[] default '{}'::uuid[],
    p_ingredients uuid[] default '{}'::uuid[],
    p_tags uuid[] default '{}'::uuid[],
    p_blacklist uuid[] default '{}'::uuid[],
    p_exclude uuid[] default '{}'::uuid[],
    p_difficulty text default null,
    p_limit integer default 6
)
    returns table
            (
                id                 uuid,
                name               text,
                description        text,
                short_description  text,
                image              text,
                difficulty         text,
                favourite_count    integer,
                total_time_minutes integer,
                ingredients        jsonb,
                tags               jsonb,
                blocker_id         uuid,
                blocker_name       text,
                blocked_diets      text[]
            )
    language sql
    stable
as
$function$
with
    -- The requested dietary tags, split the way `find_recipes` splits them: a
    -- diet with a rule is answered from the ingredients, one without it from
    -- the tag the row carries.
    diets as (select t.id                               as tag_id,
                     t.canonical_id,
                     dr.forbidden,
                     (dr.diet_canonical_id is not null) as is_derived
              from unnest(p_diets) as req(id)
                       join tags t on t.id = req.id and t.type = 'dietary'
                       left join dietary_rules dr
                                 on dr.diet_canonical_id = t.canonical_id),

    derived as (select * from diets where is_derived),

    -- Every property any requested derivable diet forbids. The union is what
    -- makes "one change" mean one change for all of them at once.
    forbidden as (select coalesce(
                                 (select array_agg(distinct p)
                                  from derived d,
                                       unnest(d.forbidden) as p),
                                 '{}'::dietary_property[]) as props),

    -- Subtree expansion for the session tags and the tag-carried diets, as
    -- `find_recipes` does (20260803000002).
    tag_roots as (select id
                  from unnest(p_tags) as t(id)
                  union
                  select tag_id from diets where not is_derived),

    tag_expanded as (select s.root_id, s.tag_id
                     from tag_subtree(array(select id from tag_roots)) s),

    tag_root_count as (select count(*)::integer as n from tag_roots),

    -- THE EDIT (20260902000001). One row per REQUESTED ingredient with every id
    -- that is the same thing, and the blacklist closed over the same relation.
    -- Same construction as `find_recipes`, and the count below is off the raw
    -- argument for the same fail-closed reason.
    requested_ingredients as (select distinct req.id                         as request_id,
                                              ingredient_identity_ids(array [req.id]) as group_ids
                              from unnest(p_ingredients) as req(id)),

    requested_ingredient_count as (select count(distinct t)::integer as n
                                   from unnest(p_ingredients) as t),

    -- Unnested to a RELATION rather than kept as an array: `= any (<subquery>)`
    -- is the set form and would compare a uuid against the array itself.
    blacklist_ids as (select unnest(ingredient_identity_ids(p_blacklist)) as id),

    -- Candidates: every visible recipe passing the predicates that are NOT
    -- being relaxed. Variants included, collapsed below — the same construction
    -- `find_recipes` uses, so an escalated hard copy is reachable and a dish
    -- still never occupies two rows.
    --
    -- RLS on `recipes` is what scopes this to the shared catalogue plus the
    -- caller's own imports; see the header.
    candidate as (select r.id,
                         r.name,
                         r.description,
                         r.short_description,
                         r.image,
                         r.difficulty::text                as difficulty,
                         r.favourite_count,
                         r.total_time_minutes,
                         lower(coalesce(r.name_ascii, '') || ' ' ||
                               coalesce(r.name_en_ascii, ''))
                                                           as dish_text,
                         coalesce(r.base_recipe_id, r.id)   as family_id,
                         r.base_recipe_id
                  from recipes r
                  where not (r.id = any (p_exclude))
                    and ((select n from requested_ingredient_count) = 0
                      or (select count(*)
                          from requested_ingredients q
                          where exists (select 1
                                        from recipe_ingredients ri
                                        where ri.recipe_id = r.id
                                          and ri.ingredient_id = any (q.group_ids))) =
                         (select n from requested_ingredient_count))
                    and (not exists (select 1 from blacklist_ids)
                      or not exists (select 1
                                     from recipe_ingredients rib
                                              join blacklist_ids b on b.id = rib.ingredient_id
                                     where rib.recipe_id = r.id))
                    -- Session tags and the tag-carried diets, both outright.
                    -- Counted off the requested roots rather than off what
                    -- resolved, so an id matching no tag makes the filter
                    -- unsatisfiable instead of being ignored.
                    and ((select n from tag_root_count) = 0
                      or (select count(*)
                          from tag_roots q
                          where exists (select 1
                                        from tag_expanded s
                                                 join recipe_tags rt
                                                      on rt.recipe_id = r.id
                                                          and rt.tag_id = s.tag_id
                                        where s.root_id = q.id)) =
                         (select n from tag_root_count))),

    -- What stands between each candidate and every requested derivable diet.
    -- Unclassified counts, for the reason in the header.
    blocker as (select c.id                    as recipe_id,
                       i.id                    as ingredient_id,
                       i.name                  as ingredient_name,
                       i.name_ascii,
                       i.dietary_properties,
                       i.component_kind,
                       (i.dietary_classified_at is not null) as classified
                from candidate c
                         join recipe_ingredients ri on ri.recipe_id = c.id
                         join ingredients i on i.id = ri.ingredient_id
                         cross join forbidden f
                where i.dietary_classified_at is null
                   or i.dietary_properties && f.props),

    -- Exactly one, and it must be one we are willing to name.
    --
    -- `array_agg(distinct …)[1]` rather than `min()`, which has no uuid
    -- overload. The HAVING clause is what makes it well-defined: the group
    -- holds exactly one distinct id, so the subscript is picking the only
    -- element rather than an arbitrary one.
    at_distance_one as (select b.recipe_id,
                               (array_agg(distinct b.ingredient_id))[1] as ingredient_id
                        from blocker b
                        group by b.recipe_id
                        having count(distinct b.ingredient_id) = 1),

    near_miss as (select c.*,
                         i.id   as blocker_id,
                         i.name as blocker_name
                  from candidate c
                           join at_distance_one d on d.recipe_id = c.id
                           join ingredients i on i.id = d.ingredient_id
                  where
                    -- Never name an ingredient nobody has checked.
                      i.dietary_classified_at is not null
                    -- The medium/protagonist split. `<@` is containment: every
                    -- property the blocker carries must be swappable, so a soy
                    -- sauce (gluten, soy, grain) is out on any one of the
                    -- three.
                    and i.dietary_properties <@
                        (select coalesce(array_agg(property), '{}'::dietary_property[])
                         from near_miss_swappable_properties)
                    -- An ingredient that is itself a dish is a protagonist:
                    -- a pizza dough, a béchamel. `classify-ingredient-component`
                    -- is what fills this in.
                    and coalesce(i.component_kind::text, '') <> 'dish'
                    -- And the dish must not be named for it.
                    and not blocker_named_in_dish(c.dish_text, i.name_ascii)),

    -- One row per dish, the copy closest to the requested skill level.
    family_pick as (select distinct on (n.family_id) n.*
                    from near_miss n
                    order by n.family_id,
                             difficulty_preference_rank(n.difficulty, nullif(p_difficulty, '')),
                             (n.base_recipe_id is not null),
                             n.id)

select f.id,
       f.name,
       f.description,
       f.short_description,
       f.image,
       f.difficulty,
       f.favourite_count,
       f.total_time_minutes,
       coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name)
                 from ingredients i
                          join recipe_ingredients ri on ri.ingredient_id = i.id
                 where ri.recipe_id = f.id), '[]'::jsonb),
       coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                 from tags t
                          join recipe_tags rt on rt.tag_id = t.id
                 where rt.recipe_id = f.id), '[]'::jsonb),
       f.blocker_id,
       f.blocker_name,
       -- Which of the reader's diets this one ingredient is standing in the way
       -- of. Usually one; "egg" blocks both vegan and egg-free for someone who
       -- set both, and a caller that wants to say so has the list.
       coalesce((select array_agg(distinct d.canonical_id order by d.canonical_id)
                 from derived d
                          join ingredients bi on bi.id = f.blocker_id
                 where bi.dietary_properties && d.forbidden), '{}'::text[])
from family_pick f
-- Same ordering as `find_recipes`, minus the source split: this returns one
-- kind of row. Skill level first because it is the reader's own stated
-- preference, then global popularity, then a stable tiebreak.
--
-- No pantry key here, deliberately. This rail answers "one swap from suiting
-- your DIET"; ordering it by what is in the fridge would put two unrelated
-- questions in one list, and the card's whole sentence is about the blocker.
order by difficulty_preference_rank(f.difficulty, nullif(p_difficulty, '')),
         f.favourite_count desc,
         f.name,
         f.id
limit greatest(p_limit, 0);
$function$;

comment on function public.find_near_miss_recipes(uuid[], uuid[], uuid[], uuid[], uuid[], text, integer) is
    'Catalogue recipes exactly one swappable ingredient away from satisfying the caller''s diets, with that ingredient named. Retrieval only — nothing is adapted. SECURITY INVOKER: scoped by RLS on recipes. See 20260830000001; ingredient identity closure added 20260902000001.';

grant execute on function public.find_near_miss_recipes(uuid[], uuid[], uuid[], uuid[], uuid[], text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
