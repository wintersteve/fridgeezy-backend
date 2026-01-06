-- Create cooking action aliases table for handling synonyms
create table cooking_action_aliases
(
    id         UUID primary key     default gen_random_uuid(),
    action_id  UUID        not null references cooking_actions (id) on delete cascade,
    alias      TEXT        not null unique,
    created_at TIMESTAMPTZ not null default now()
);

COMMENT on table cooking_action_aliases is
'Maps synonyms and alternative names to canonical cooking actions (e.g., "chop finely" -> "mince").';

create index idx_cooking_action_aliases_action_id on cooking_action_aliases (action_id);
create index idx_cooking_action_aliases_alias on cooking_action_aliases (alias);

alter table cooking_action_aliases enable row level security;

create policy "public_read"
    on cooking_action_aliases for select
    using (true);

create policy "public_insert"
    on cooking_action_aliases for insert
    with check (true);
