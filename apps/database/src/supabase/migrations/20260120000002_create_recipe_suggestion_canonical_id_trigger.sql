-- Create trigger to automatically set canonical_id from name for recipe_suggestions
-- This ensures the canonical_id is always in sync with the name field

create or replace function set_recipe_suggestion_canonical_id()
returns trigger as $$
begin
  new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
  return new;
end;
$$
language plpgsql;

create trigger set_recipe_suggestion_canonical_id_trigger
    before insert or update on recipe_suggestions
    for each row
    execute function set_recipe_suggestion_canonical_id();
