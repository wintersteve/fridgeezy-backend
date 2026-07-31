-- Cooking action vocabulary: the verbs recipe instructions are tagged with.
--
-- Self-contained — nothing here references recipes; recipe_instructions points
-- the other way.

create table if not exists cooking_action_categories
(
    id          uuid primary key                  default gen_random_uuid(),
    name        text                     not null unique,
    description text,
    sort_order  integer                  not null default 0,
    created_at  timestamp with time zone not null default now()
);

create index if not exists idx_cooking_action_categories_name on cooking_action_categories using btree (name);
create index if not exists idx_cooking_action_categories_sort_order on cooking_action_categories using btree (sort_order);

create table if not exists cooking_actions
(
    id          uuid primary key                  default gen_random_uuid(),
    -- RESTRICT, not CASCADE: dropping a category would otherwise silently take
    -- its actions and every instruction's reference to them.
    category_id uuid                     not null references cooking_action_categories (id) on delete restrict,
    name        text                     not null unique,
    description text,
    tips        text,
    created_at  timestamp with time zone not null default now()
);

create index if not exists idx_cooking_actions_category_id on cooking_actions using btree (category_id);
create index if not exists idx_cooking_actions_name on cooking_actions using btree (name);

create table if not exists cooking_action_aliases
(
    id         uuid primary key                  default gen_random_uuid(),
    action_id  uuid                     not null references cooking_actions (id) on delete cascade,
    alias      text                     not null unique,
    created_at timestamp with time zone not null default now()
);

create index if not exists idx_cooking_action_aliases_action_id on cooking_action_aliases using btree (action_id);
create index if not exists idx_cooking_action_aliases_alias on cooking_action_aliases using btree (alias);

alter table cooking_action_categories enable row level security;
alter table cooking_actions enable row level security;
alter table cooking_action_aliases enable row level security;

create policy public_read on cooking_action_categories for select using (true);
create policy public_insert on cooking_action_categories for insert with check (true);
create policy public_read on cooking_actions for select using (true);
create policy public_insert on cooking_actions for insert with check (true);
create policy public_read on cooking_action_aliases for select using (true);
create policy public_insert on cooking_action_aliases for insert with check (true);
