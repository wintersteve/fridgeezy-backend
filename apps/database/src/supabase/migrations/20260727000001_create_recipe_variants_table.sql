-- User-owned variants of a recipe: a modification (e.g. "vegetarian",
-- "gluten-free") the user asked the AI to make and chose to keep. The variant
-- recipe content lives as an ordinary row in `recipes` (as escalate/generate
-- already write); this table only links a user to that row and to the original
-- it was derived from. Mirrors the collection_recipes ownership model.
create table recipe_variants
(
    id             UUID primary key     default gen_random_uuid(),
    profile_id     UUID        not null references profiles (id) on delete cascade,
    base_recipe_id UUID        not null references recipes (id) on delete cascade,
    recipe_id      UUID        not null references recipes (id) on delete cascade,
    label          TEXT        not null,
    created_at     TIMESTAMPTZ not null default NOW(),
    -- A given variant row is kept by a user at most once.
    unique (profile_id, recipe_id)
);

-- Indexes: look up a user's variants for a base recipe (the "Your versions"
-- selector) and reverse-check whether a recipe row is kept by anyone (cron).
create index idx_recipe_variants_profile_base on recipe_variants (profile_id, base_recipe_id);
create index idx_recipe_variants_recipe_id on recipe_variants (recipe_id);

-- Enable Row Level Security
alter table recipe_variants enable row level security;

-- Users can manage their own variants
create
policy "users_manage_own_recipe_variants" on recipe_variants
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
