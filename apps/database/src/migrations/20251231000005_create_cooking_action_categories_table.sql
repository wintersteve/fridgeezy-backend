-- Create cooking action categories table
create table cooking_action_categories
(
    id          UUID primary key     default gen_random_uuid(),
    name        TEXT        not null unique,
    description TEXT,
    sort_order  INTEGER     not null default 0,
    created_at  TIMESTAMPTZ not null default now()
);

COMMENT on column cooking_action_categories.sort_order is
'Controls display order in UIs. Lower numbers appear first.';

create index idx_cooking_action_categories_name on cooking_action_categories (name);
create index idx_cooking_action_categories_sort_order on cooking_action_categories (sort_order);

alter table cooking_action_categories enable row level security;

create policy "public_read"
    on cooking_action_categories for select
    using (true);

create policy "public_insert"
    on cooking_action_categories for insert
    with check (true);
