-- Create function for vector search on ingredients table
-- This function enables semantic similarity search for ingredient matching
create or replace function search_ingredients(
    query_embedding vector(1536),
    match_threshold float default 0.85,
    match_count int default 1
)
returns table (
    id uuid,
    name text,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        i.id,
        i.name,
        1 - (i.embedding <=> query_embedding) as similarity
    from ingredients i
    where i.embedding is not null
      and (1 - (i.embedding <=> query_embedding)) >= match_threshold
    order by i.embedding <=> query_embedding
    limit match_count;
end;
$$;
