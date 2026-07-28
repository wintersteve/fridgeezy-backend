-- Phase 1 (embedding consolidation) — slice 2b: recipes.
--
-- Consolidate recipes onto text-embedding-3-small (1536) and stop embedding
-- inside Postgres:
--   1. Drop the BEFORE-INSERT/UPDATE trigger that called generate_embedding()
--      (an OpenAI HTTP call from Postgres) to populate recipes.fts.
--   2. Change recipes.fts from vector(3072) (large) to vector(1536) (small).
--      Existing vectors are dropped and re-populated by the app-side backfill
--      script (generate-recipe-embeddings.ts).
--   3. search_recipes takes a precomputed 1536-dim query embedding instead of
--      embedding the query text internally.
--
-- The persist_recipe / persist_recipe_with_ingredient_ids RPCs are intentionally
-- left unchanged: the application sets fts via a small follow-up update
-- (RecipesRepository.updateEmbedding) rather than threading a vector through those
-- large functions.
--
-- ⚠️ After applying, run the backfill (nx run @fridgeezy/database:embed-recipes)
-- and deploy the matching app build together — fts is null until backfilled, and
-- the search_recipes signature changes.

-- 1. Remove the in-Postgres embedding trigger + function.
drop trigger if exists trigger_set_recipe_embedding on recipes;
drop function if exists set_recipe_embedding();

-- 2. 3072 (large) -> 1536 (small). Drop + re-add clears the incompatible vectors;
--    the backfill re-embeds every row with text-embedding-3-small.
alter table recipes drop column if exists fts;
alter table recipes add column fts vector(1536);

comment on column recipes.fts is
'Vector embedding of the recipe name (text-embedding-3-small, 1536 dims).
Supplied by the application via RecipesRepository.updateEmbedding; not generated
inside Postgres.';

-- 3. search_recipes: take a precomputed 1536-dim query embedding.
drop function if exists search_recipes(text, float, int);

create or replace function search_recipes(
    query_embedding vector(1536),
    match_threshold FLOAT default 0.5,
    match_count INT default 10
)
returns table (
    id UUID,
    name TEXT,
    score FLOAT
) as $$
begin
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

comment on function search_recipes(vector, FLOAT, INT) is
'Vector similarity search for recipes. Takes a precomputed text-embedding-3-small
(1536-dim) query embedding from the application (no embedding is generated inside
Postgres). Excludes AI-modified variants (base_recipe_id is not null).';
