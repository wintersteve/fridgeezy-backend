-- Keep AI-modified variants out of recipe discovery. A variant is persisted as
-- an ordinary `recipes` row that deliberately keeps the base recipe's NAME (see
-- the modify-recipe prompt), so every search surface showed the catalogue recipe
-- alongside one indistinguishable duplicate per variant ever streamed.
--
-- Lineage belongs on the recipe row itself, not on `recipe_variants`: that table
-- is the per-user *save* link, is RLS-scoped to its owner, and doesn't exist yet
-- for a variant the user is still looking at. A column here covers both saved
-- variants and not-yet-saved ones, for every user.
alter table recipes
    add column base_recipe_id UUID references recipes (id) on delete set null;

comment
on column recipes.base_recipe_id is
'Set when this recipe is an AI-modified variant of another recipe; points at the family base (never at another variant). Rows with a non-null value are excluded from discovery/search.';

-- Supports the reverse lookup "which variants derive from this recipe".
create index idx_recipes_base_recipe_id on recipes (base_recipe_id) where base_recipe_id is not null;

-- Backfill the variants that were already saved before this column existed.
update recipes r
set base_recipe_id = v.base_recipe_id
from recipe_variants v
where v.recipe_id = r.id
  and r.base_recipe_id is null;

-- Re-declare find_recipes (home feed, search, browse, compose-menu search) to
-- skip variants. Body is unchanged apart from the added predicate in
-- `candidate_recipes`.
create
or replace function public.find_recipes (
  p_difficulty text default null,
  ingredients uuid[] default array[]::uuid[],
  tags uuid[] default array[]::uuid[],
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
    select r.id, r.name, r.description, r.image, r.difficulty::text as difficulty
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
    select rs.id, rs.name, rs.description, rs.difficulty::text as difficulty
    from recipe_suggestions rs
    where
      (difficulty_filter is null or rs.difficulty::text = difficulty_filter)
      and rs.id not in (select id from recipe_rows)
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

-- Same for the vector-similarity fallback the search screens use when FTS finds
-- nothing.
create or replace function search_recipes(
    search_query TEXT,
    match_threshold FLOAT default 0.5,
    match_count INT default 10
)
returns table (
    id UUID,
    name TEXT,
    score FLOAT
) as $$
declare
    query_embedding vector(3072);
begin
    -- Generate embedding for search query
    query_embedding := generate_embedding(search_query);

    if query_embedding is null then
        raise exception 'Failed to generate embedding for search query';
    end if;

    return query
    select
        r.id,
        r.name,
        1 - (r.fts <=> query_embedding) as score
    from recipes r
    where r.fts is not null
      and r.base_recipe_id is null
      and 1 - (r.fts <=> query_embedding) >= match_threshold
    order by r.fts <=> query_embedding
    limit match_count;
end;
$$ language plpgsql stable;

COMMENT on function search_recipes(TEXT, FLOAT, INT) is
'Vector similarity search for recipes. Returns top matches with similarity scores. Uses cosine similarity on fts embeddings. Excludes AI-modified variants (base_recipe_id is not null).';
