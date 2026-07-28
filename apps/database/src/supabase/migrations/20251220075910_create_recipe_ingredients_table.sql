create table recipe_ingredients
(
    id            UUID primary key     default gen_random_uuid(),
    recipe_id     UUID        not null references recipes (id) on delete cascade,
    ingredient_id UUID        not null references ingredients (id) on delete cascade,
    quantity      DECIMAL(10, 3) not null,
    unit_id       UUID        not null references units (id),
    created_at    TIMESTAMPTZ not null default now(),
    unique (recipe_id, ingredient_id)
);

create index idx_recipe_ingredients_recipe_id on recipe_ingredients (recipe_id);
create index idx_recipe_ingredients_ingredient_id on recipe_ingredients (ingredient_id);
create index idx_recipe_ingredients_unit_id on recipe_ingredients (unit_id);

alter table recipe_ingredients ENABLE row level security;

create
POLICY "public_read"
    on recipe_ingredients for
select using (true);

create
POLICY "public_insert"
    on recipe_ingredients for
insert
with check (true);