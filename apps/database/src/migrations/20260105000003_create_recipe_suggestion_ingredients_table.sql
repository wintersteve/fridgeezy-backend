-- Create recipe_suggestion_ingredients join table
-- This links recipe suggestions to ingredients with a simple many-to-many relationship
-- Unlike recipe_ingredients, this table does NOT include quantity or unit information

create table recipe_suggestion_ingredients
(
    id                   UUID primary key     default gen_random_uuid(),
    recipe_suggestion_id UUID        not null references recipe_suggestions (id) on delete cascade,
    ingredient_id        UUID        not null references ingredients (id) on delete cascade,
    created_at           TIMESTAMPTZ not null default now(),

    -- Ensure each ingredient is only listed once per suggestion
    unique (recipe_suggestion_id, ingredient_id)
);

COMMENT
on table recipe_suggestion_ingredients is
'Join table linking recipe suggestions to ingredients.
Unlike recipe_ingredients, this table only tracks which ingredients are used,
without quantity or unit information. This is intentional for the simplified suggestion model.';

-- Indexes for foreign key relationships
create index idx_recipe_suggestion_ingredients_recipe_id on recipe_suggestion_ingredients (recipe_suggestion_id);

create index idx_recipe_suggestion_ingredients_ingredient_id on recipe_suggestion_ingredients (ingredient_id);

-- Row level security policies
alter table recipe_suggestion_ingredients enable row level security;

create
policy "public_read"
    on recipe_suggestion_ingredients for
select using (true);

create
policy "public_insert"
    on recipe_suggestion_ingredients for insert
    with check (true);

create
policy "public_update"
    on recipe_suggestion_ingredients for
update using (true);

create
policy "public_delete"
    on recipe_suggestion_ingredients for delete
using (true);
