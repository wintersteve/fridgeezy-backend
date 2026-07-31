-- Flip what `name` and `name_en` mean.
--
-- Until now `name` held the dish's name in its source language and `name_en` an
-- English translation, and every read coalesced `name_en ?? name`. That rule is
-- wrong in both directions: it renders "Green Papaya Salad" over "Som Tam" and
-- "Rice Noodle Soup" over "Pho", while still needing the translation for
-- Murgh Makhani -> Butter Chicken. Which name a dish is recognised by is a
-- per-dish judgement, not a language rule.
--
-- From here `name` IS the canonical display name — the one an English-speaking
-- home cook recognises — chosen per dish by the model at generation time, and
-- `name_en` is merely the alternate spelling kept for search recall and dedup.
-- Nothing coalesces any more; every surface reads `name`.
--
-- The column keeps the `name_en` name (renaming it would churn six RPC bodies,
-- the generated types and both repos for no functional gain), so the comments
-- below are the record of what it actually holds now.
comment on column recipes.name is
  'Canonical display name: the name this dish is most recognised by in English (native where that is the common usage — Pho, Paella, Kimchi — English where it is not — Butter Chicken, Apple Strudel). Rendered as-is everywhere; never coalesced with name_en.';

comment on column recipes.name_en is
  'Alternate name: the native spelling when `name` is English, the English translation when `name` is native. Never displayed — used only for search recall, findBaseRecipe and dedup. Null when the dish is only ever known by one name.';

comment on column recipe_suggestions.name is
  'Canonical display name: the name this dish is most recognised by in English (native where that is the common usage — Pho, Paella, Kimchi — English where it is not — Butter Chicken, Apple Strudel). Rendered as-is everywhere; never coalesced with name_en.';

comment on column recipe_suggestions.name_en is
  'Alternate name: the native spelling when `name` is English, the English translation when `name` is native. Never displayed — used only for search recall, findBaseRecipe and dedup. Null when the dish is only ever known by one name.';

-- Rebuilt verbatim from 20260730000004 apart from the display-name resolution:
-- the `coalesce(name_en, name) as display_name` in both candidate CTEs is gone
-- and the rows carry `name` straight through. The result type is unchanged, but
-- it is positional and the function signature is unchanged too, so a plain
-- `create or replace` would suffice — dropped and recreated anyway to stay
-- consistent with how this function has been migrated so far.
drop function if exists public.find_recipes (text, uuid[], uuid[], uuid[], integer);

drop type if exists public.find_recipes_result;

create type public.find_recipes_result as (
    id uuid,
    name text,
    description text,
    short_description text,
    image text,
    difficulty text,
    favourite_count integer,
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
      r.description,
      r.short_description,
      r.image,
      r.difficulty::text as difficulty,
      r.favourite_count
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
