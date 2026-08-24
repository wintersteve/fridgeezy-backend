-- How big is this result, what is in it, and stop showing an idea for a dish
-- that already has a recipe.
--
-- Three changes to `find_recipes`, one of them a fix and two of them new
-- columns. All three exist to answer the same question from the search screen:
-- what does a reader do when a filter matches more dishes than a phone can
-- show?
--
-- ## 1. The suggestion-suppression window (a fix)
--
-- A suggestion is hidden when its dish already has a recipe. That check read
-- `candidate_recipes`, which is `family_picks` truncated to
-- `limit_count + p_offset` — so it was PAGE-DEPENDENT. A recipe outside the
-- window could not suppress its own suggestion, and the dish came back twice:
-- as an illustrated recipe, and as an idea offering to write the recipe that
-- already exists.
--
-- It has never fired in production, because the final ORDER BY puts every
-- recipe ahead of every suggestion — so by the time a suggestion is reached the
-- window already covers the whole catalogue. That is an accident of the current
-- catalogue being small, not a property of the query, and the failure mode is
-- silent. It now checks `family_picks`, which is the complete matching set.
--
-- ## 2. `total_recipes` / `total_suggestions`
--
-- The client could not say how many results there were. A page shorter than
-- `limit_count` is the paging signal (see 20260806000003), which is cheap and
-- deliberately count-free — but it means the feed header could only ever report
-- how much had been LOADED, a number that climbs as you scroll and therefore
-- says nothing about whether to keep scrolling or to narrow the search.
--
-- Counts DISHES rather than rows: `family_picks` has already collapsed each
-- family to one copy, so a dish with three difficulty rungs counts once.
--
-- ## 3. `facets`
--
-- The dish-form tags carried by the matching set, with counts, most common
-- first — the raw material for a chip rail that narrows a hundred rows in one
-- tap. Computed over the whole match rather than over the page for the reason
-- given at the CTE: a facet derived from twelve rows describes the paging, not
-- the results.
--
-- ## Shape
--
-- `add attribute` appends, so the three new columns are LAST and in this order.
-- The function is dropped first so the composite type has no dependency to
-- argue about, then recreated — the same dance as 20260812000004 and
-- 20260815000003.
--
-- Body reproduced from the live definition (20260815000006). Four edits, all
-- marked in place.

drop function if exists public.find_recipes(text, uuid[], uuid[], uuid[], integer, integer);

alter type find_recipes_result
    add attribute total_recipes integer;

alter type find_recipes_result
    add attribute total_suggestions integer;

alter type find_recipes_result
    add attribute facets jsonb;

CREATE OR REPLACE FUNCTION public.find_recipes(p_difficulty text DEFAULT NULL::text, ingredients uuid[] DEFAULT ARRAY[]::uuid[], tags uuid[] DEFAULT ARRAY[]::uuid[], blacklist uuid[] DEFAULT ARRAY[]::uuid[], limit_count integer DEFAULT 10, p_offset integer DEFAULT 0)
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
        coalesce(array_length(ingredients, 1), 0) = 0
        or (
          select count(distinct ri.ingredient_id)
          from recipe_ingredients ri
          where ri.recipe_id = r.id
            and ri.ingredient_id = any (ingredients)
        ) = array_length(ingredients, 1)
      )
      and (
        coalesce(array_length(blacklist, 1), 0) = 0
        or not exists (
          select 1
          from recipe_ingredients rib
          where rib.recipe_id = r.id
            and rib.ingredient_id = any (blacklist)
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
   * 1b. One row per dish — the copy closest to the requested difficulty.
   *
   * Note the band travels WITH the difficulty pick rather than being read
   * separately: an easy and a hard copy of one dish have different times, and
   * the pill has to describe the copy actually being shown.
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
      m.origin
    from matching_recipes m
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
      -- LAST, matching the attribute appended to the result type.
      c.origin
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
        coalesce(array_length(ingredients, 1), 0) = 0
        or (
          select count(distinct rsi.ingredient_id)
          from recipe_suggestion_ingredients rsi
          where rsi.recipe_suggestion_id = rs.id
            and rsi.ingredient_id = any (ingredients)
        ) = array_length(ingredients, 1)
      )
      and (
        coalesce(array_length(blacklist, 1), 0) = 0
        or not exists (
          select 1
          from recipe_suggestion_ingredients rsib
          where rsib.recipe_suggestion_id = rs.id
            and rsib.ingredient_id = any (blacklist)
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
   * 3b. Every dish-form tag carried by anything these filters match, counted.
   *
   * Over the WHOLE matching set, not over the page — which is the only version
   * of this worth sending. Counted off the 12 rows a page happens to contain,
   * a facet chip says "Noodles" or stays silent depending on alphabetical
   * order, and the reader is offered a narrowing that is an artefact of paging.
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
      -- LAST, and in the same position as recipe_rows above — the union below
      -- matches on position, not on name. NULL because a suggestion has no
      -- provenance: nobody has written the dish down yet.
      null::text as origin
    from suggestion_candidates sc
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
  -- LAST, and in `add attribute` order — the composite type appends, and a
  -- mismatch here is a per-row runtime error rather than a build failure.
  tr.total_recipes,
  ts.total_suggestions,
  fj.facets
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
cross join (select count(*)::integer as total_recipes from family_picks) tr
cross join (select count(*)::integer as total_suggestions from suggestion_candidates) ts
cross join facet_json fj
-- Real recipes before suggestions, then closest-to-preference, then most
-- liked, then by name.
order by
  case c.source when 'recipe' then 0 else 1 end,
  difficulty_preference_rank(c.difficulty, difficulty_filter),
  -- The only signal of "best" this schema has. Below the difficulty tier
  -- because skill level is a stated preference and a like count is inferred
  -- taste; a hard dish should not outrank an easy one for a beginner just for
  -- being popular.
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

comment on function public.find_recipes(text, uuid[], uuid[], uuid[], integer, integer) is
    'Discovery feed. Difficulty RANKS rather than filters (20260803000001); every row carries the result-set totals and dish-form facets so the client can describe a result it has only partly loaded.';

notify pgrst, 'reload schema';
