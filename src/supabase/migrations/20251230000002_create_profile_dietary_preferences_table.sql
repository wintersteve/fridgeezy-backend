-- Junction table linking profiles to tags (dietary preferences)
create table profile_dietary_preferences
(
    id         UUID primary key     default gen_random_uuid(),
    profile_id UUID        not null references profiles (id) on delete cascade,
    tag_id     UUID        not null references tags (id) on delete cascade,
    created_at TIMESTAMPTZ not null default NOW(),
    unique (profile_id, tag_id)
);

-- Indexes
create index idx_profile_dietary_preferences_profile_id on profile_dietary_preferences (profile_id);
create index idx_profile_dietary_preferences_tag_id on profile_dietary_preferences (tag_id);

-- Enable Row Level Security
alter table profile_dietary_preferences ENABLE row level security;

-- Users can manage their own dietary preferences
create
POLICY "users_manage_own_dietary_preferences" on profile_dietary_preferences
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
