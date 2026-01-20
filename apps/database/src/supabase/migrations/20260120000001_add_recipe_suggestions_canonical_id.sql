-- Add canonical_id column to recipe_suggestions table
-- This will be used to prevent duplicate suggestions with the same normalized name

alter table recipe_suggestions
    add column canonical_id text;

-- Backfill existing rows with canonical_id based on their name
update recipe_suggestions
set canonical_id = regexp_replace(lower(trim(name)), '[^a-z0-9]+', '_', 'g')
where canonical_id is null;

-- Make the column NOT NULL after backfilling
alter table recipe_suggestions
    alter column canonical_id set not null;

-- Add unique constraint to prevent duplicates
alter table recipe_suggestions
    add constraint recipe_suggestions_canonical_id_unique unique (canonical_id);

-- Add index for faster lookups
create index idx_recipe_suggestions_canonical_id on recipe_suggestions (canonical_id);

comment on column recipe_suggestions.canonical_id is
'Normalized version of the recipe name for deduplication. Auto-generated from name field.';
