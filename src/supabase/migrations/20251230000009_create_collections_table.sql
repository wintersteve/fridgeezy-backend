-- Recipe collections that users can create
create table collections
(
    id          UUID primary key     default gen_random_uuid(),
    profile_id  UUID        not null references profiles (id) on delete cascade,
    title       TEXT        not null,
    description TEXT,
    created_at  TIMESTAMPTZ not null default NOW(),
    updated_at  TIMESTAMPTZ not null default NOW()
);

-- Indexes
create index idx_collections_profile_id on collections (profile_id);

-- Enable Row Level Security
alter table collections enable row level security;

-- Users can manage their own collections
create
policy "users_manage_own_collections" on collections
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));

-- Junction table for recipes in collections (many-to-many)
create table collection_recipes
(
    id            UUID primary key     default gen_random_uuid(),
    collection_id UUID        not null references collections (id) on delete cascade,
    recipe_id     UUID        not null references recipes (id) on delete cascade,
    created_at    TIMESTAMPTZ not null default NOW(),
    unique (collection_id, recipe_id)
);

-- Indexes
create index idx_collection_recipes_collection_id on collection_recipes (collection_id);
create index idx_collection_recipes_recipe_id on collection_recipes (recipe_id);

-- Enable Row Level Security
alter table collection_recipes enable row level security;

-- Users can manage recipes in their own collections
create
policy "users_manage_own_collection_recipes" on collection_recipes
    for all using (collection_id in (select id from collections where profile_id in (select id from profiles where user_id = auth.uid())));
