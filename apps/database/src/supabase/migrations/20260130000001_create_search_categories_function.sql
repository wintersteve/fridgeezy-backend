-- Always returns the best matching category (no threshold filtering)
-- Guarantees a result as long as at least one category has an embedding
create or replace function search_categories(
    query_embedding vector(1536),
    match_count int default 1
)
returns table (
    id uuid,
    name text,
    canonical_id text,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        c.id,
        c.name,
        c.canonical_id,
        1 - (c.embedding <=> query_embedding) as similarity
    from categories c
    where c.embedding is not null
    order by c.embedding <=> query_embedding
    limit match_count;
end;
$$;
