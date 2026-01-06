-- Trigger function to auto-generate embeddings for recipe name + description
create or replace function set_recipe_embedding()
returns trigger as $$
declare
    combined_text TEXT;
begin
    -- Combine name and description for richer semantic search
    combined_text := COALESCE(NEW.name, '');
    combined_text := TRIM(LOWER(combined_text));

    -- Only generate embedding if text has changed or embedding doesn't exist
    if combined_text != '' and (
        TG_OP = 'INSERT' or
        OLD.name is distinct from NEW.name or
        NEW.fts is null
    ) then
        -- Generate embedding (may be NULL if API call fails)
        NEW.fts := generate_embedding(combined_text);
    end if;

    return NEW;
end;
$$ language plpgsql;

COMMENT on function set_recipe_embedding() is
'Auto-generates embedding for recipe name + description on INSERT/UPDATE. Skips if text unchanged.';

-- Apply trigger to recipes table
create trigger trigger_set_recipe_embedding
    before insert or update on recipes
    for each row
    execute function set_recipe_embedding();

COMMENT on trigger trigger_set_recipe_embedding on recipes is
'Automatically generates vector embedding when recipe name or description changes';
