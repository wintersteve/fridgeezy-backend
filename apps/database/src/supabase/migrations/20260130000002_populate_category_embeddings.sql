do $$
declare
    cat record;
begin
    for cat in select id, name from categories where embedding is null
    loop
        update categories
        set embedding = generate_embedding_small(cat.name)
        where id = cat.id;

        perform pg_sleep(0.1);  -- Avoid rate limiting
    end loop;
end $$;
