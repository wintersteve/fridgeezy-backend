-- Update search_tags to accept a query string and generate embedding internally
-- This matches the pattern used by search_recipes for consistency

drop function if exists search_tags(vector(1536), tag_type, float, int);

create or replace function search_tags(
    search_query TEXT,
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
declare
    query_embedding vector(1536);
begin
    -- Generate embedding for search query using the small model (1536 dims)
    query_embedding := generate_embedding_small(search_query);

    if query_embedding is null then
        raise exception 'Failed to generate embedding for search query';
    end if;

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
Generates the embedding internally using text-embedding-3-small (1536 dimensions).
Only searches canonical tags (where canonical_id = name) as aliases do not have embeddings.
Returns tags above the similarity threshold, ordered by similarity score.
Primarily used for dietary tags to handle variations like "no gluten" → "gluten_free".

Parameters:
- search_query: The text query to search for (embedding generated internally)
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
