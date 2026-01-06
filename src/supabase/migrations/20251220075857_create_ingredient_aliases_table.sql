create table ingredient_aliases
(
    id            UUID primary key     default gen_random_uuid(),
    ingredient_id UUID        not null references ingredients (id) on delete cascade,
    alias         TEXT        not null unique,
    created_at    TIMESTAMPTZ not null default now()
);

create index idx_ingredient_aliases_ingredient_id on ingredient_aliases (ingredient_id);
create index idx_ingredient_aliases_alias on ingredient_aliases (alias);

alter table ingredient_aliases enable row level security;

create policy "public_read" on ingredient_aliases for select using (true);
create policy "public_insert" on ingredient_aliases for insert with check (true);
