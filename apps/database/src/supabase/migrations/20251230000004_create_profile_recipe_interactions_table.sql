-- Create enum for recipe interaction types
create type recipe_interaction_type as ENUM ('viewed', 'favourite', 'cooked');

-- Single table for all recipe interactions (viewed, favourite, cooked)
create table profile_recipe_interactions
(
    id               UUID primary key                 default gen_random_uuid(),
    profile_id       UUID                    not null references profiles (id) on delete cascade,
    recipe_id        UUID                    not null references recipes (id) on delete cascade,
    interaction_type recipe_interaction_type not null,
    created_at       TIMESTAMPTZ             not null default NOW(),
    unique (profile_id, recipe_id, interaction_type)
);

-- Indexes
create index idx_profile_recipe_interactions_profile_id on profile_recipe_interactions (profile_id);
create index idx_profile_recipe_interactions_recipe_id on profile_recipe_interactions (recipe_id);
create index idx_profile_recipe_interactions_type on profile_recipe_interactions (interaction_type);

-- Enable Row Level Security
alter table profile_recipe_interactions ENABLE row level security;

-- Users can manage their own recipe interactions
create
POLICY "users_manage_own_recipe_interactions" on profile_recipe_interactions
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
