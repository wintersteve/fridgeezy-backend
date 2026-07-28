-- User settings table (1-to-1 with profiles)
create table profile_settings
(
    id         UUID primary key     default gen_random_uuid(),
    profile_id UUID        not null unique references profiles (id) on delete cascade,
    servings   INTEGER     not null default 4,
    unit_id    UUID        references units (id) on delete set null,
    difficulty difficulty_type      default 'medium',
    created_at TIMESTAMPTZ not null default NOW(),
    updated_at TIMESTAMPTZ not null default NOW()
);

-- Indexes
create index idx_profile_settings_profile_id on profile_settings (profile_id);

create index idx_profile_settings_unit_id on profile_settings (unit_id);

-- Enable Row Level Security
alter table profile_settings ENABLE row level security;

-- Users can manage their own settings
create
POLICY "users_manage_own_settings" on profile_settings
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));
