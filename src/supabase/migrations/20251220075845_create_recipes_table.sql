create type difficulty_type as enum ('easy', 'medium', 'hard');

create table recipes
(
    id           UUID primary key     default gen_random_uuid(),
    name         TEXT        not null,
    description  TEXT,
    difficulty   difficulty_type,
    servings     INTEGER     not null default 4,
    prep_time    TEXT,
    cook_time    TEXT,
    instructions TEXT[] not null default '{}',
    tips         TEXT[],
    created_at   TIMESTAMPTZ not null default now(),
    updated_at   TIMESTAMPTZ not null default now()
);

alter table recipes ENABLE row level security;

create
POLICY "public_read"
    on recipes for
select using (true);

create
POLICY "public_insert"
    on recipes for
insert
with check (true);