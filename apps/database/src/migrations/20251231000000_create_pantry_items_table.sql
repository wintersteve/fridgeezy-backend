-- Table for managing user's pantry items
create table pantry_items
(
    id              UUID primary key        default gen_random_uuid(),
    profile_id      UUID           not null references profiles (id) on delete cascade,
    ingredient_id   UUID           not null references ingredients (id) on delete cascade,
    created_at      TIMESTAMPTZ    not null default now(),
    updated_at      TIMESTAMPTZ    not null default now(),
    unique (profile_id, ingredient_id)
);

-- Indexes
create index idx_pantry_items_profile_id on pantry_items (profile_id);
create index idx_pantry_items_ingredient_id on pantry_items (ingredient_id);

-- Enable Row Level Security
alter table pantry_items enable row level security;

-- Users can manage their own pantry items
create
policy "users_manage_own_pantry_items" on pantry_items
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));

