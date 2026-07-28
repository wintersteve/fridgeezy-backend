-- Phase 1 (embedding consolidation): move the query embedding out of Postgres.
--
-- search_tags previously took a TEXT query and called generate_embedding_small()
-- (an OpenAI HTTP call from inside Postgres via the http extension). It now
-- receives a precomputed text-embedding-3-small (1536-dim) vector from the
-- application, matching search_ingredients / search_categories / search_units.
-- The stored tag embeddings are unchanged (already 1536-dim small), so no
-- re-embedding is required.

drop function if exists search_tags(text, tag_type, float, int);

create or replace function search_tags(
    query_embedding vector(1536),
    match_type tag_type,
    match_threshold float default 0.75,
    match_count int default 5
)
returns table (
    id uuid,
    name text,
    canonical_id text,
    type tag_type,
    embedding vector(1536),
    similarity float
)
language plpgsql
as $$
begin
    return QUERY
    select t.id,
           t.name,
           t.canonical_id,
           t.type,
           t.embedding,
           -- Calculate cosine similarity (1 - cosine distance)
           1 - (t.embedding <=> query_embedding) as similarity
    from tags t
    where t.type = match_type
      -- Only search canonical tags (aliases don't have embeddings)
      and t.embedding is not null
      and t.canonical_id = t.name
      -- Filter by similarity threshold
      and (1 - (t.embedding <=> query_embedding)) >= match_threshold
    -- Order by most similar first (lowest cosine distance)
    order by t.embedding <=> query_embedding
    LIMIT match_count;
end;
$$;

COMMENT on function search_tags is
'Find similar canonical tags using cosine similarity on embeddings.
Takes a precomputed text-embedding-3-small (1536-dim) query embedding from the
application (no embedding is generated inside Postgres).
Only searches canonical tags (where canonical_id = name) as aliases do not have embeddings.
Returns tags above the similarity threshold, ordered by similarity score.
Primarily used for dietary tags to handle variations like "no gluten" -> "gluten_free".

Parameters:
- query_embedding: Precomputed 1536-dim query embedding
- match_type: Tag type to filter (dietary, cuisine, component, course)
- match_threshold: Minimum cosine similarity score (0-1, default 0.75)
- match_count: Maximum number of results to return (default 5)

Returns:
- id: Tag UUID
- name: Canonical tag name (e.g., "gluten_free")
- canonical_id: Same as name for canonical tags
- type: Tag type
- embedding: The tag embedding vector
- similarity: Cosine similarity score (0-1, higher is more similar)';
