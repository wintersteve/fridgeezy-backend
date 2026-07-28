-- Table for user saved prompts
create table prompts
(
    id         UUID primary key     default gen_random_uuid(),
    profile_id UUID        not null references profiles (id) on delete cascade,
    prompt     TEXT        not null,
    position   INTEGER     not null default 0,
    created_at TIMESTAMPTZ not null default now(),
    updated_at TIMESTAMPTZ not null default now(),
    unique (profile_id, position)
);

-- Indexes
create index idx_prompts_profile_id on prompts (profile_id);

-- Enable Row Level Security
alter table prompts enable row level security;

-- Users can manage their own prompts
create
policy "users_manage_own_prompts" on prompts
    for all using (profile_id in (select id from profiles where user_id = auth.uid()));