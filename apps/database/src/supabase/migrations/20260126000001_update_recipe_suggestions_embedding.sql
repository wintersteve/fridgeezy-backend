-- Remove promotion tracking columns from recipe_suggestions
alter table recipe_suggestions drop column if exists promoted_to_recipe_id;
alter table recipe_suggestions drop column if exists promoted_at;

-- Add vector column for embeddings (3072 dimensions for text-embedding-3-large)
alter table recipe_suggestions add column embedding vector(3072);

COMMENT on column recipe_suggestions.embedding is
'Vector embedding of recipe suggestion name + description for semantic similarity search. Generated via OpenAI text-embedding-3-large (3072 dimensions).';

-- Trigger function to auto-generate embeddings for recipe suggestion name + description
create or replace function set_recipe_suggestion_embedding()
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
        NEW.embedding is null
    ) then
        -- Generate embedding (may be NULL if API call fails)
        NEW.embedding := generate_embedding(combined_text);
    end if;

    return NEW;
end;
$$ language plpgsql;

COMMENT on function set_recipe_suggestion_embedding() is
'Auto-generates embedding for recipe suggestion name + description on INSERT/UPDATE. Skips if text unchanged.';

-- Apply trigger to recipe_suggestions table
create trigger trigger_set_recipe_suggestion_embedding
    before insert or update on recipe_suggestions
    for each row
    execute function set_recipe_suggestion_embedding();

COMMENT on trigger trigger_set_recipe_suggestion_embedding on recipe_suggestions is
'Automatically generates vector embedding when recipe suggestion name or description changes';