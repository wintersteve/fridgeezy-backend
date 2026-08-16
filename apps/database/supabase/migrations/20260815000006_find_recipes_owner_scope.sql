-- Keep owned recipes out of everybody else's discovery feed.
--
-- `20260815000005` put the visibility rule on the tables, where RLS enforces it
-- for every direct read the client makes. It does nothing at all for the two
-- functions below:
--
--   * `find_recipes` is SECURITY DEFINER. It runs as its owner and never
--     consults a policy, which is the entire point — it reads `dietary_rules`
--     and the display-tag views on behalf of callers who cannot. So the row
--     filter has to be written into the query itself, and an owned recipe was
--     until this migration a first-class citizen of the shared home feed.
--   * `search_recipes` is SECURITY INVOKER, but its only caller is the API's
--     dedup path (`search-recipes.ts`), which holds the SERVICE ROLE and so
--     bypasses RLS by design. Same outcome by a different route.
--
-- Both apply `recipe_is_visible(created_by)` — the same function the policies
-- use, so the four places the rule now lives cannot drift apart.
--
-- ## `current_profile_id()` inside a SECURITY DEFINER function
--
-- Works, and is worth being explicit about because it looks like it should not.
-- The definer switch changes the effective ROLE; it does not touch the
-- `request.jwt.claims` GUC that `auth.uid()` reads, which PostgREST sets per
-- request regardless. So the feed still knows who is asking. An unauthenticated
-- caller resolves to NULL, `created_by = NULL` is NULL rather than true, and a
-- guest sees exactly the unowned catalogue — which is the correct answer and the
-- one guest browsing already assumes.

------------------------------------------------------------------------------
-- 1. search_recipes — dedup searches the CATALOGUE
------------------------------------------------------------------------------
--
-- This one is not really about privacy, though it delivers that too. The
-- function exists to answer "does this dish already exist here?" during
-- suggestion dedup, and the corpus that question is about is the shared
-- catalogue. Left open, one user's imported "Grandma's Lasagna" could suppress a
-- lasagna suggestion for every other user in the app — a leak of the fact, if
-- not the content, plus a silently worse feed for everyone.
--
-- Keyed on `created_by` rather than `origin` for the reason 20260815000005 gives
-- for the check constraint: imported implies owned, so one predicate covers both
-- and there is nothing for a second to disagree with.
--
-- Body reproduced from 20260801000011, which is the live definition. One edit.

create or replace function public.search_recipes(query_embedding vector, match_threshold double precision default 0.5,
                                                 match_count integer default 10)
    returns table
            (
                id    uuid,
                name  text,
                score double precision
            )
    language plpgsql
    stable
as $function$
begin
    return query
        select r.id,
               r.name,
               1 - (r.fts <=> query_embedding) as score
        from recipes r
        where r.fts is not null
          and r.base_recipe_id is null
          -- The one edit. NOT recipe_is_visible(): this caller is the service
          -- role running dedup with no user at all, so "visible to me" is the
          -- wrong question — "is it part of the shared corpus" is the right one,
          -- and it must answer the same way whoever is asking.
          and r.created_by is null
          and 1 - (r.fts <=> query_embedding) >= match_threshold
        order by r.fts <=> query_embedding
        limit match_count;
end;
$function$;

------------------------------------------------------------------------------
-- 2. find_recipes — the feed
------------------------------------------------------------------------------
--
-- `create or replace`, not drop-and-recreate: `find_recipes_result` is unchanged
-- (`origin` was appended to it by 20260815000003 and this migration adds no
-- column), so there is no composite type to rebuild and no dependency to argue
-- about. Signature and return type are byte-identical to the live definition.
--
-- Body reproduced from `pg_get_functiondef`. ONE edit, marked in place, in the
-- `matching_recipes` CTE — the single place every recipe row enters this
-- function. Filtering there rather than at the end is deliberate: it happens
-- before `family_picks` collapses a dish to one row, so an owned variant cannot
-- win the pick and take a catalogue dish out of somebody else's feed with it.

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
      -- Reads `candidate_recipes`, which is now owner-scoped — so one user's
      -- import can no longer hide a suggestion from anybody else, and cannot
      -- hide one from its own owner either, since for them it IS the same dish.
      not exists (
        select 1
        from candidate_recipes c
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
  c.origin
from combined c
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

notify pgrst, 'reload schema';
