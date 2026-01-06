-- Create categories table
create table categories
(
    id          UUID primary key     default gen_random_uuid(),
    description TEXT,
    image_url   TEXT,
    name        TEXT        not null unique,
    created_at  TIMESTAMPTZ not null default now()
);

create index idx_categories_name on categories (name);

alter table categories ENABLE row level security;

create
POLICY "public_read"
    on categories for
select using (true);