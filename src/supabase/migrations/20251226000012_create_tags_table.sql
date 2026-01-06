-- Create enum for tag types
create type tag_type as enum ('dietary', 'component', 'course', 'cuisine');

-- Create tags table
create table tags
(
    id           UUID primary key     default gen_random_uuid(),
    created_at   TIMESTAMPTZ not null default now(),
    canonical_id TEXT        not null,
    parent_id    UUID        references tags (id) on delete set null,
    description  TEXT,
    image_url    TEXT,
    name         TEXT        not null,
    type         tag_type    not null,
    embedding    vector(1536),

    constraint tags_name_type_unique unique (name, type)
);

COMMENT
on column tags.canonical_id is
'Normalized matching key (underscore format like "gluten_free"). For canonical tags: canonical_id = name. Aliases are stored in the separate tag_aliases table.';

COMMENT
on column tags.parent_id is
'Optional reference to parent tag for hierarchical relationships (e.g., cantonese → chinese). Must be same tag type.';

COMMENT
on column tags.description is
'Optional description field. Primarily used for cuisine and component tags. NULL for dietary and course tags.';

COMMENT
on column tags.image_url is
'Optional image URL field. Primarily used for cuisine and component tags. NULL for dietary and course tags.';

COMMENT
on column tags.embedding is
'Vector embedding of tag name for semantic similarity search. Generated via OpenAI text-embedding-3-small (1536 dimensions). Primarily used for dietary tags.';

create index idx_tags_type on tags (type);

create index idx_tags_name on tags (name);

create index idx_tags_canonical_id on tags (canonical_id);

create index idx_tags_parent_id on tags (parent_id);

-- HNSW index for fast similarity search (supports up to 2000 dimensions)
create index idx_tags_embedding on tags using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

COMMENT
on index idx_tags_embedding is
'HNSW index for fast cosine similarity search on tag embeddings. Optimized for 1536-dim vectors.';

alter table tags enable row level security;

create
policy "public_read"
    on tags for
select using (true);

create
policy "public_insert"
    on tags for insert
    with check (true);

create
policy "public_update"
    on tags for
update using (true);
