create table tag_aliases
(
    id           UUID primary key     default gen_random_uuid(),
    tag_id       UUID        not null references tags (id) on delete cascade,
    canonical_id TEXT        not null,
    alias        TEXT        not null,
    type         tag_type    not null, -- Denormalized for fast lookup without JOIN
    created_at   TIMESTAMPTZ not null default now(),

    -- Unique constraint: one alias per type (e.g., "gluten free" can only exist once for dietary)
    constraint tag_aliases_alias_type_unique unique (alias, type)
);

COMMENT
on table tag_aliases is
'Maps alternative names (aliases) to canonical tags. Canonical tags are stored in the tags table with canonical_id = name.';

COMMENT
on column tag_aliases.tag_id is
'Foreign key to the canonical tag in the tags table.';

COMMENT
on column tag_aliases.alias is
'Alternative name for the tag (e.g., "gluten free" for canonical tag "gluten_free"). Typically uses space-delimited format.';

COMMENT
on column tag_aliases.type is
'Denormalized tag type for fast lookups without JOIN. Must match the parent tag type.';

create index idx_tag_aliases_alias on tag_aliases (alias);
create index idx_tag_aliases_tag_id on tag_aliases (tag_id);
create index idx_tag_aliases_type on tag_aliases (type);

COMMENT
on index idx_tag_aliases_alias is
'Fast lookup of tags by alias name. Primary index for tag matching queries.';

-- ============================================================================
-- Step 3: Enable Row Level Security
-- ============================================================================

alter table tag_aliases ENABLE row level security;

create
POLICY "public_read"
    on tag_aliases for
select using (true);

create
POLICY "public_insert"
    on tag_aliases for insert
    with check (true);

COMMENT
on POLICY "public_read" on tag_aliases is
'Allow public read access to tag aliases for recipe generation and tag matching.';

commit;
