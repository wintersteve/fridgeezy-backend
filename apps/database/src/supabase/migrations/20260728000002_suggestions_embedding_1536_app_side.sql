-- Phase 1 (embedding consolidation) — slice 2a: recipe_suggestions.
--
-- Consolidate onto text-embedding-3-small (1536) and stop embedding inside
-- Postgres:
--   1. Drop the BEFORE-INSERT/UPDATE trigger that called generate_embedding()
--      (an OpenAI HTTP call from Postgres) to populate the embedding.
--   2. Change recipe_suggestions.embedding from vector(3072) (large) to
--      vector(1536) (small). Existing vectors are dropped and re-populated by
--      the app-side backfill script (generate-suggestion-embeddings.ts).
--   3. persist_suggestion now takes the precomputed embedding from the app.
--   4. search_recipe_suggestions takes a precomputed 1536-dim query embedding
--      instead of embedding the query text internally.
--
-- ⚠️ After applying, run the backfill (nx run @fridgeezy/database:embed-suggestions)
-- and deploy the matching app build together — the embedding column is null until
-- backfilled, and persist_suggestion / search_recipe_suggestions signatures change.

-- 1. Remove the in-Postgres embedding trigger + function.
drop trigger if exists trigger_set_recipe_suggestion_embedding on recipe_suggestions;
drop function if exists set_recipe_suggestion_embedding();

-- 2. 3072 (large) -> 1536 (small). Drop + re-add clears the incompatible vectors;
--    the backfill re-embeds every row with text-embedding-3-small.
alter table recipe_suggestions drop column if exists embedding;
alter table recipe_suggestions add column embedding vector(1536);

comment on column recipe_suggestions.embedding is
'Vector embedding of the suggestion name (text-embedding-3-small, 1536 dims).
Supplied by the application via persist_suggestion; not generated inside Postgres.';

-- 3. persist_suggestion: accept the precomputed embedding. Drop the older
--    overloads (5-arg and 6-arg) so only the canonical function remains.
drop function if exists persist_suggestion(text, text, difficulty_type, uuid[], uuid[]);
drop function if exists persist_suggestion(text, text, difficulty_type, uuid[], uuid[], text);

create or replace function persist_suggestion(
    p_name text,
    p_description text,
    p_difficulty difficulty_type,
    p_ingredient_ids uuid[],
    p_tag_ids uuid[],
    p_embedding vector(1536),
    p_name_en text default null
)
returns uuid
language plpgsql
as $$
declare
    v_suggestion_id uuid;
    v_ingredient_id uuid;
    v_tag_id uuid;
begin
    -- Insert new suggestion with its precomputed embedding
    insert into recipe_suggestions (name, description, difficulty, name_en, embedding)
    values (p_name, p_description, p_difficulty, p_name_en, p_embedding)
    returning id into v_suggestion_id;

    -- Insert ingredient associations
    foreach v_ingredient_id in array p_ingredient_ids loop
        insert into recipe_suggestion_ingredients (recipe_suggestion_id, ingredient_id)
        values (v_suggestion_id, v_ingredient_id)
        on conflict (recipe_suggestion_id, ingredient_id) do nothing;
    end loop;

    -- Insert tag associations
    foreach v_tag_id in array p_tag_ids loop
        insert into recipe_suggestion_tags (recipe_suggestion_id, tag_id)
        values (v_suggestion_id, v_tag_id)
        on conflict (recipe_suggestion_id, tag_id) do nothing;
    end loop;

    return v_suggestion_id;
end;
$$;

comment on function persist_suggestion(text, text, difficulty_type, uuid[], uuid[], vector, text) is
'Atomically persists a recipe suggestion with relations and its precomputed
text-embedding-3-small (1536-dim) embedding. Returns the new suggestion ID.';

-- 4. search_recipe_suggestions: take a precomputed 1536-dim query embedding.
drop function if exists search_recipe_suggestions(text, float, int);

create or replace function search_recipe_suggestions(
    query_embedding vector(1536),
    match_threshold FLOAT default 0.5,
    match_count INT default 10
)
returns table (
    id UUID,
    name TEXT,
    description TEXT,
    difficulty difficulty_type,
    score FLOAT
) as $$
begin
    return query
    select
        rs.id,
        rs.name,
        rs.description,
        rs.difficulty,
        1 - (rs.embedding <=> query_embedding) as score
    from recipe_suggestions rs
    where rs.embedding is not null
      and 1 - (rs.embedding <=> query_embedding) >= match_threshold
    order by rs.embedding <=> query_embedding
    limit match_count;
end;
$$ language plpgsql stable;

comment on function search_recipe_suggestions(vector, FLOAT, INT) is
'Vector similarity search for recipe suggestions. Takes a precomputed
text-embedding-3-small (1536-dim) query embedding from the application (no
embedding is generated inside Postgres). Returns top matches by cosine similarity.';
