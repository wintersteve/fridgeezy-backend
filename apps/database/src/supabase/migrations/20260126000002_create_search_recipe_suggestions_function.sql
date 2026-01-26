-- Vector similarity search function for recipe suggestions
create or replace function search_recipe_suggestions(
    search_query TEXT,
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

COMMENT on function search_recipe_suggestions(TEXT, FLOAT, INT) is
'Vector similarity search for recipe suggestions. Returns top matches with similarity scores. Uses cosine similarity on embedding column.';
