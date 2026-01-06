create table ingredients
(
    id               UUID primary key     default gen_random_uuid(),
    parent_id        UUID        references ingredients (id) on delete set null,
    name             TEXT        not null unique,
    category_id      UUID        references categories (id) on delete set null,
    description      TEXT,
    image_url        TEXT,
    nutritional_info JSONB,
    storage_tips     TEXT,
    shelf_life       TEXT, -- e.g., "3-5 days refrigerated", "1 year dried"
    created_at       TIMESTAMPTZ not null default now()
);

comment
on column ingredients.nutritional_info is
'Nutritional information per 100g. Example structure: {"calories": 165, "protein": 31, "carbs": 0, "fat": 3.6, "fiber": 0, "sodium": 74, "serving_size": "100g"}';

create index idx_ingredients_name on ingredients (name);

create index idx_ingredients_parent_id on ingredients (parent_id);

create index idx_ingredients_category_id on ingredients (category_id);

create index idx_ingredients_nutritional_info on ingredients using gin (nutritional_info);

alter table ingredients ENABLE row level security;

create
POLICY "public_read"
    on ingredients for
select using (true);

create
POLICY "public_insert"
    on ingredients for
insert
with check (true);