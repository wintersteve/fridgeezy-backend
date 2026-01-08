-- Table for prompt variables
create table prompt_variables
(
    id            UUID primary key              default gen_random_uuid(),
    prompt_id     UUID                 not null references prompts (id) on delete cascade,
    variable_type prompt_variable_type not null,
    tag_type      tag_type,
    position      INTEGER              not null,
    label         TEXT                 not null,
    created_at    TIMESTAMPTZ          not null default now(),
    unique (prompt_id, position),
    unique (prompt_id, label)
);

-- Indexes
create index idx_prompt_variables_prompt_id on prompt_variables (prompt_id);

-- Enable Row Level Security
alter table prompt_variables enable row level security;

-- Users can manage variables for their own prompts
create
policy "users_manage_own_prompt_variables" on prompt_variables
    for all using (prompt_id in (select id from prompts where profile_id in (select id from profiles where user_id = auth.uid())));
