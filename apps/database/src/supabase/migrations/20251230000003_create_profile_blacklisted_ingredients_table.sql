-- Junction table for blacklisted ingredients
create table profile_blacklisted_ingredients
(
    id            UUID primary key     default gen_random_uuid(),
    profile_id    UUID        not null references profiles (id) on delete cascade,
    ingredient_id UUID        not null references ingredients (id) on delete cascade,
    created_at    TIMESTAMPTZ not null default NOW(),
    unique (profile_id, ingredient_id)
);

-- Indexes
create index idx_profile_blacklisted_ingredients_profile_id on profile_blacklisted_ingredients (profile_id);
create index idx_profile_blacklisted_ingredients_ingredient_id on profile_blacklisted_ingredients (ingredient_id);

-- Enable Row Level Security
alter table profile_blacklisted_ingredients ENABLE row level security;

-- Users can manage their own blacklisted ingredients
create
POLICY "users_manage_own_blacklisted_ingredients" on profile_blacklisted_ingredients
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
