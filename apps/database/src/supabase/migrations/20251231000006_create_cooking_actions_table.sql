-- Create cooking actions table
create table cooking_actions
(
    id          UUID primary key     default gen_random_uuid(),
    category_id UUID        not null references cooking_action_categories (id) on delete restrict,
    name        TEXT        not null unique,
    description TEXT,
    tips        TEXT,
    created_at  TIMESTAMPTZ not null default now()
);

COMMENT on column cooking_actions.description is
'Detailed explanation of the cooking technique or action.';

COMMENT on column cooking_actions.tips is
'Best practices or helpful hints for performing this cooking action.';

create index idx_cooking_actions_category_id on cooking_actions (category_id);
create index idx_cooking_actions_name on cooking_actions (name);

alter table cooking_actions enable row level security;

create policy "public_read"
    on cooking_actions for select
    using (true);

create policy "public_insert"
    on cooking_actions for insert
    with check (true);
