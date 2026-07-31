-- Vector search RPCs.
--
-- All of them take a PRECOMPUTED query embedding: the database no longer
-- generates vectors, the API does (@fridgeezy/openai, text-embedding-3-small).
-- The old in-database generate_embedding()/generate_embedding_small() helpers,
-- which called out over the http extension, were dropped when that moved
-- app-side — one network hop per row, inside a transaction, was the reason.
--
-- Score is expressed as similarity (1 - cosine distance) while ordering uses
-- the raw `<=>` distance, so the HNSW index is actually used.

create or replace function public.search_categories(query_embedding vector, match_count integer default 1)
    returns table
            (
                id           uuid,
                name         text,
                canonical_id text,
                similarity   double precision
            )
    language plpgsql
as $function$
begin
    return query
        select c.id,
               c.name,
               c.canonical_id,
               1 - (c.embedding <=> query_embedding) as similarity
        from categories c
        where c.embedding is not null
        order by c.embedding <=> query_embedding
        limit match_count;
end;
$function$;

create or replace function public.search_units(query_embedding vector, match_count integer default 1)
    returns table
            (
                id           uuid,
                name         text,
                abbreviation text,
                canonical_id text,
                similarity   double precision
            )
    language plpgsql
as $function$
begin
    return query
        select u.id,
               u.name,
               u.abbreviation,
               u.canonical_id,
               1 - (u.embedding <=> query_embedding) as similarity
        from units u
        where u.embedding is not null
        order by u.embedding <=> query_embedding
        limit match_count;
end;
$function$;

create or replace function public.search_ingredients(query_embedding vector, match_threshold double precision default 0.85,
                                                     match_count integer default 1)
    returns table
            (
                id         uuid,
                name       text,
                similarity double precision
            )
    language plpgsql
as $function$
begin
    return query
        select i.id,
               i.name,
               1 - (i.embedding <=> query_embedding) as similarity
        from ingredients i
        where i.embedding is not null
          and (1 - (i.embedding <=> query_embedding)) >= match_threshold
        order by i.embedding <=> query_embedding
        limit match_count;
end;
$function$;

-- `t.canonical_id = t.name` restricts matching to canonical tags: aliases live
-- in tag_aliases and carry no embedding.
create or replace function public.search_tags(query_embedding vector, match_type tag_type,
                                              match_threshold double precision default 0.75,
                                              match_count integer default 5)
    returns table
            (
                id           uuid,
                name         text,
                canonical_id text,
                type         tag_type,
                embedding    vector,
                similarity   double precision
            )
    language plpgsql
as $function$
begin
    return query
        select t.id,
               t.name,
               t.canonical_id,
               t.type,
               t.embedding,
               1 - (t.embedding <=> query_embedding) as similarity
        from tags t
        where t.type = match_type
          and t.embedding is not null
          and t.canonical_id = t.name
          and (1 - (t.embedding <=> query_embedding)) >= match_threshold
        order by t.embedding <=> query_embedding
        limit match_count;
end;
$function$;

-- Variants are excluded (base_recipe_id is null): a user's private edit must
-- never surface in discovery.
create or replace function public.search_recipes(query_embedding vector, match_threshold double precision default 0.5,
                                                 match_count integer default 10)
    returns table
            (
                id    uuid,
                name  text,
                score double precision
            )
    language plpgsql
    stable
as $function$
begin
    return query
        select r.id,
               r.name,
               1 - (r.fts <=> query_embedding) as score
        from recipes r
        where r.fts is not null
          and r.base_recipe_id is null
          and 1 - (r.fts <=> query_embedding) >= match_threshold
        order by r.fts <=> query_embedding
        limit match_count;
end;
$function$;

create or replace function public.search_recipe_suggestions(query_embedding vector,
                                                            match_threshold double precision default 0.5,
                                                            match_count integer default 10)
    returns table
            (
                id          uuid,
                name        text,
                description text,
                difficulty  difficulty_type,
                score       double precision
            )
    language plpgsql
    stable
as $function$
begin
    return query
        select rs.id,
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
$function$;
