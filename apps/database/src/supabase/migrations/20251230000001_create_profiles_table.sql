-- Create profiles table connected to auth.users
create table profiles
(
    id                   UUID primary key     default gen_random_uuid(),
    user_id              UUID        not null unique references auth.users (id) on delete cascade,
    display_name         TEXT,
    avatar_url           TEXT,
    onboarding_completed BOOLEAN     not null default false,
    created_at           TIMESTAMPTZ not null default NOW(),
    updated_at           TIMESTAMPTZ not null default NOW()
);

-- Indexes
create index idx_profiles_user_id on profiles (user_id);

-- Enable Row Level Security
alter table profiles ENABLE row level security;

-- Users can only read their own profile
create
POLICY "users_read_own_profile" on profiles
    for
select using (auth.uid() = user_id);

-- Users can only update their own profile
create
POLICY "users_update_own_profile" on profiles
    for
update USING (auth.uid() = user_id);
