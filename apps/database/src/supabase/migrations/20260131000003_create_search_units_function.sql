-- Vector similarity search for units
-- Always returns the best matching unit (no threshold filtering)
-- Guarantees a result as long as at least one unit has an embedding

CREATE OR REPLACE FUNCTION search_units(
    query_embedding vector(1536),
    match_count int DEFAULT 1
)
RETURNS TABLE (
    id uuid,
    name text,
    abbreviation text,
    canonical_id text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.name,
        u.abbreviation,
        u.canonical_id,
        1 - (u.embedding <=> query_embedding) AS similarity
    FROM units u
    WHERE u.embedding IS NOT NULL
    ORDER BY u.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION search_units IS 'Finds the most semantically similar units using vector embeddings. Always returns the best match without threshold filtering.';
