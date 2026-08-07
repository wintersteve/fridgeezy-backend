-- Two fixes to find_recipes' ordering, both about what "best first" means.
--
-- 1. PAGINATION SKIPPED RECIPES. `candidate_recipes` truncates the recipe pool
--    with `limit limit_count` before the union with suggestions and before the
--    final LIMIT/OFFSET. That is a performance guard — `recipe_rows` runs two
--    jsonb aggregates per row — and it was correct while there was only ever one
--    page. 20260806000003 added `p_offset` without widening it, so at limit 12
--    offset 12 the pool held the FIRST 12 recipes and the final offset skipped
--    every one of them: page two opened on suggestions, and recipes 13+ could
--    not be reached at any offset. The feed then generated AI suggestions while
--    real recipes were still unshown, which is the opposite of the intended
--    order. The pool now covers the whole requested window.
--
-- 2. RANK BY LIKES, NOT ALPHABETICALLY. After the source and difficulty tiers
--    the order fell through to `c.name`, and those two tiers tie constantly — so
--    in practice the feed was alphabetical. A capers search opened "Ajiaco,
--    Bagels with Lox, Chicken Marbella…", A to V, which reads as a ranking and
--    is not one.
--
-- `favourite_count` is the only signal of "best" the schema carries. There is no
-- relevance score to rank by and there cannot be one: ingredients, tags and the
-- blacklist are all-of filters, so every returned row matches the query equally
-- well. That is also why this is a default rather than a user-facing sort
-- control — roughly nine of ten rows are suggestions, which have no times, no
-- calories, no image and no likes to sort on.
--
-- Signature unchanged, so `create or replace` is enough; no drop is needed (see
-- 20260806000003, where adding a parameter did need one).
create or replace function public.find_recipes(p_difficulty text default null::text,
                                               ingredients uuid[] default array []::uuid[],
                                               tags uuid[] default array []::uuid[],
                                               blacklist uuid[] default array []::uuid[],
                                               limit_count integer default 10,
                                               p_offset integer default 0)
    returns setof find_recipes_result
    language plpgsql
    security definer
as $function$
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
      -- A dish's family: its base's id, or its own when it IS the base.
      coalesce(r.base_recipe_id, r.id) as family_id,
      r.base_recipe_id
    from recipes r
    where
      (
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
   * ------------------------------------------------- */
  family_picks as (
    select distinct on (m.family_id)
      m.id,
      m.name,
      m.description,
      m.short_description,
      m.image,
      m.difficulty,
      m.favourite_count
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
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name)
          order by dt.name
        )
        from recipe_display_tags dt
        where dt.recipe_id = c.id
      ), '[]'::jsonb) as tags,
      'recipe'::text as source
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
      rs.difficulty::text as difficulty
    from recipe_suggestions rs
    where
      rs.canonical_id not in (
        select regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '_', 'g')
        from candidate_recipes c
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
          jsonb_build_object('id', dt.id, 'name', dt.name)
          order by dt.name
        )
        from recipe_suggestion_display_tags dt
        where dt.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as tags,
      'suggestion'::text as source
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
  c.source
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
