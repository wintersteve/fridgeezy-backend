-- Reference/catalog tables: categories, units, tags, tag_aliases.
--
-- Grouped into one file because they are the shared vocabulary everything else
-- points at, they carry no dependencies on recipe or profile data, and the
-- seeds load them as a unit.
--
-- Every embedding column is vector(1536) with an HNSW cosine index. The vectors
-- are produced application-side (@fridgeezy/openai, text-embedding-3-small) —
-- the database has no embedding function of its own; the pg_embedding helpers
-- that used to exist were dropped once generation moved into the API.

create table if not exists categories
(
    id           uuid primary key                  default gen_random_uuid(),
    canonical_id text                     not null unique,
    name         text                     not null unique,
    description  text,
    image_url    text,
    embedding    vector(1536),
    created_at   timestamp with time zone not null default now()
);

create index if not exists idx_categories_canonical_id on categories using btree (canonical_id);
create index if not exists idx_categories_name on categories using btree (name);
create index if not exists idx_categories_embedding on categories using hnsw (embedding vector_cosine_ops) with (m = '16', ef_construction = '64');

create trigger set_category_canonical_id_trigger
    before insert or update
    on categories
    for each row
execute function set_category_canonical_id();

create table if not exists units
(
    id                uuid primary key                  default gen_random_uuid(),
    name              text                     not null unique,
    abbreviation      text                     not null unique,
    system            unit_system              not null,
    type              unit_type                not null,
    base_unit_id      uuid references units (id),
    conversion_factor numeric(20, 10),
    embedding         vector(1536),
    created_at        timestamp with time zone not null default now(),
    canonical_id      text                     not null,
    constraint units_canonical_id_unique unique (canonical_id)
);

create index if not exists idx_units_canonical_id on units using btree (canonical_id);
create index if not exists idx_units_system on units using btree (system);
create index if not exists idx_units_type on units using btree (type);
create index if not exists idx_units_embedding on units using hnsw (embedding vector_cosine_ops) with (m = '16', ef_construction = '64');

-- UPDATE OF name, not a blanket UPDATE: re-stamping on every write would fight
-- the embedding backfill, which updates these rows without touching the name.
create trigger set_unit_canonical_id_trigger
    before insert or update of name
    on units
    for each row
execute function set_unit_canonical_id();

create table if not exists tags
(
    id           uuid primary key                  default gen_random_uuid(),
    created_at   timestamp with time zone not null default now(),
    canonical_id text                     not null,
    parent_id    uuid references tags (id) on delete set null,
    description  text,
    image_url    text,
    name         text                     not null,
    type         tag_type                 not null,
    embedding    vector(1536),
    constraint tags_name_type_unique unique (name, type)
);

-- Unique on canonical_id alone, as a standalone index rather than a table
-- constraint — a tag name is unique per type, but the canonical id is unique
-- outright so cross-type alias collisions are impossible.
create unique index if not exists tags_canonical_id_unique on tags using btree (canonical_id);
create index if not exists idx_tags_canonical_id on tags using btree (canonical_id);
create index if not exists idx_tags_name on tags using btree (name);
create index if not exists idx_tags_parent_id on tags using btree (parent_id);
create index if not exists idx_tags_type on tags using btree (type);
create index if not exists idx_tags_embedding on tags using hnsw (embedding vector_cosine_ops) with (m = '16', ef_construction = '64');

create table if not exists tag_aliases
(
    id           uuid primary key                  default gen_random_uuid(),
    tag_id       uuid                     not null references tags (id) on delete cascade,
    canonical_id text                     not null,
    alias        text                     not null,
    type         tag_type                 not null,
    created_at   timestamp with time zone not null default now(),
    constraint tag_aliases_alias_type_unique unique (alias, type)
);

create index if not exists idx_tag_aliases_alias on tag_aliases using btree (alias);
create index if not exists idx_tag_aliases_tag_id on tag_aliases using btree (tag_id);
create index if not exists idx_tag_aliases_type on tag_aliases using btree (type);

create trigger tag_alias_canonical_id_trigger
    before insert or update
    on tag_aliases
    for each row
execute function set_tag_alias_canonical_id();

alter table categories enable row level security;
alter table units enable row level security;
alter table tags enable row level security;
alter table tag_aliases enable row level security;

create policy public_read on categories for select using (true);
create policy public_read on units for select using (true);
create policy public_read on tags for select using (true);
create policy public_insert on tags for insert with check (true);
create policy public_update on tags for update using (true);
create policy public_read on tag_aliases for select using (true);
create policy public_insert on tag_aliases for insert with check (true);
