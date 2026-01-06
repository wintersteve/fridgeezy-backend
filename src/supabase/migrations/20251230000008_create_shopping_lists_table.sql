-- Shopping lists that users can save (one list per recipe)
create table shopping_lists
(
    id         UUID primary key     default gen_random_uuid(),
    profile_id UUID        not null references profiles (id) on delete cascade,
    recipe_id  UUID        not null references recipes (id) on delete cascade,
    name       TEXT,
    created_at TIMESTAMPTZ not null default NOW(),
    updated_at TIMESTAMPTZ not null default NOW()
);

-- Indexes
create index idx_shopping_lists_profile_id on shopping_lists (profile_id);
create index idx_shopping_lists_recipe_id on shopping_lists (recipe_id);

-- Enable Row Level Security
alter table shopping_lists enable row level security;

-- Users can manage their own shopping lists
create
policy "users_manage_own_shopping_lists" on shopping_lists
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
