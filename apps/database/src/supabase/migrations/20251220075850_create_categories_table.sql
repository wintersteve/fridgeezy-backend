-- Create categories table
create table categories
(
    id           UUID primary key     default gen_random_uuid(),
    canonical_id TEXT        not null unique,
    name         TEXT        not null unique,
    description  TEXT,
    image_url    TEXT,
    embedding    vector(1536),
    created_at   TIMESTAMPTZ not null default now()
);

create index idx_categories_name on categories (name);
create index idx_categories_canonical_id on categories (canonical_id);

alter table categories ENABLE row level security;

create
POLICY "public_read"
    on categories for
select using (true);