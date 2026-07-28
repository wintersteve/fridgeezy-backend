-- Add comment column to recipe_ingredients table
-- This allows storing preparation notes like "peeled", "deveined", "crushed", etc.
alter table recipe_ingredients
    add column comment TEXT;

comment on column recipe_ingredients.comment is
'Optional preparation note for the ingredient in this recipe (e.g., "peeled", "deveined", "crushed")';
