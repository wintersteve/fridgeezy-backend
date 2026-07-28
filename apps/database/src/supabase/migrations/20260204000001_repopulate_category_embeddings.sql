-- Re-generate all category embeddings with name + description
-- This fixes ingredient auto-assignment by including category descriptions
-- in the embeddings (e.g., "vegetable broth" now matches "Stocks: Broths, stocks, bouillon")
do $$
declare
    cat record;
begin
    for cat in select id, name, description from categories
    loop
        update categories
        set embedding = generate_embedding_small(cat.name || ': ' || cat.description)
        where id = cat.id;

        perform pg_sleep(0.1);  -- Avoid rate limiting
    end loop;
end $$;
