-- Vector similarity search function for recipes
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
      and 1 - (r.fts <=> query_embedding) >= match_threshold
    order by r.fts <=> query_embedding
    limit match_count;
end;
$$ language plpgsql stable;

COMMENT on function search_recipes(TEXT, FLOAT, INT) is
'Vector similarity search for recipes. Returns top matches with similarity scores. Uses cosine similarity on fts embeddings.';
