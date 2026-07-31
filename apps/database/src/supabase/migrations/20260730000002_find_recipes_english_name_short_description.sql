-- Return the English recipe name, and a card-sized description, from find_recipes.
--
-- Two changes, one migration, because both need the result type rebuilt:
--
-- 1. `name` is now `coalesce(name_en, name)`. Rows carry the dish's name in its
--    source language plus an English translation; the app is English-only and was
--    showing the source-language name everywhere, because the RPC has no
--    `name_en` column for the client to fall back on. Fixed here rather than in
--    the app so every caller gets it.
--
--    The *raw* name is still what the suggestion dedupe compares against
--    (`canonical_id` is derived from it), so the CTEs keep both.
--
-- 2. `short_description` (20260730000001) is exposed, falling back to nothing —
--    the client reads `short_description ?? description`. Suggestions have no
--    such column: their description is generated as a single line already, so it
--    doubles as its own short form.
--
-- Adding an attribute changes the composite type, and `alter type ... add
-- attribute` can only append — which would put `short_description` after
-- `source`. The type is positional, so it is dropped and recreated in the order
-- the columns are actually read.
--
-- Rebuilt from 20260729000003 (blacklist exclusion), itself rebuilt from
-- 20260727000011 (base_recipe_id guard + canonical_id dedupe).
drop function if exists public.find_recipes (text, uuid[], uuid[], uuid[], integer);

drop type if exists public.find_recipes_result;

create type public.find_recipes_result as (
    id uuid,
    name text,
    description text,
    short_description text,
    image text,
    difficulty text,
    ingredients jsonb,
    tags jsonb,
    source text
    );


create
or replace function public.find_recipes (
  p_difficulty text default null,
  ingredients uuid[] default array[]::uuid[],
  tags uuid[] default array[]::uuid[],
  blacklist uuid[] default array[]::uuid[],
  limit_count integer default 10
)
returns setof public.find_recipes_result
language plpgsql
security definer
as $$
declare
difficulty_filter text := null;
begin
  -- Normalize difficulty filter
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
  /* -------------------------------------------------
   * 1. Candidate recipes (strict matches)
   * ------------------------------------------------- */
  candidate_recipes as (
    select
      r.id,
      r.name,
      coalesce(r.name_en, r.name) as display_name,
      r.description,
      r.short_description,
      r.image,
      r.difficulty::text as difficulty
    from recipes r
    where
      r.base_recipe_id is null
      and (difficulty_filter is null or r.difficulty::text = difficulty_filter)
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
        coalesce(array_length(tags, 1), 0) = 0
        or (
          select count(distinct rt.tag_id)
          from recipe_tags rt
          where rt.recipe_id = r.id
            and rt.tag_id = any (tags)
        ) = array_length(tags, 1)
      )
    order by r.name
    limit limit_count
  ),

  /* -------------------------------------------------
   * 2. Recipes with relations
   * ------------------------------------------------- */
  recipe_rows as (
    select
      c.id,
      c.display_name as name,
      c.description,
      c.short_description,
      c.image,
      c.difficulty,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_ingredients ri on ri.ingredient_id = i.id
        where ri.recipe_id = c.id
      ), '[]'::jsonb) as ingredients,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', t.id, 'name', t.name)
          order by t.name
        )
        from tags t
        join recipe_tags rt on rt.tag_id = t.id
        where rt.recipe_id = c.id
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
      coalesce(rs.name_en, rs.name) as display_name,
      rs.description,
      rs.difficulty::text as difficulty
    from recipe_suggestions rs
    where
      (difficulty_filter is null or rs.difficulty::text = difficulty_filter)
      and rs.canonical_id not in (
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
        coalesce(array_length(tags, 1), 0) = 0
        or (
          select count(distinct rst.tag_id)
          from recipe_suggestion_tags rst
          where rst.recipe_suggestion_id = rs.id
            and rst.tag_id = any (tags)
        ) = array_length(tags, 1)
      )
    order by rs.name
  ),

  /* -------------------------------------------------
   * 4. Suggestions with relations
   * ------------------------------------------------- */
  suggestion_rows as (
    select
      sc.id,
      sc.display_name as name,
      sc.description,
      -- Already a single generated line: it is its own short form.
      sc.description as short_description,
      null::text as image,
      sc.difficulty,
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
          jsonb_build_object('id', t.id, 'name', t.name)
          order by t.name
        )
        from tags t
        join recipe_suggestion_tags rst
          on rst.tag_id = t.id
        where rst.recipe_suggestion_id = sc.id
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

select *
from combined limit limit_count;

end;
$$;
