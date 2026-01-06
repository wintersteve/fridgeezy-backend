-- Create recipe_suggestions table for temporary recipe suggestions
-- These are minimal recipe records that will eventually be promoted to the full recipes table

create table recipe_suggestions
(
    id                    UUID primary key     default gen_random_uuid(),
    name                  TEXT        not null,
    description           TEXT,
    difficulty            difficulty_type, -- Reuse existing enum from recipes table
    created_at            TIMESTAMPTZ not null default now(),

    -- Optional: track if this suggestion was promoted to a full recipe
    promoted_to_recipe_id UUID        references recipes (id) on delete set null,
    promoted_at           TIMESTAMPTZ
);

COMMENT
on table recipe_suggestions is
'Temporary recipe suggestions with minimal fields (id, name, description, difficulty).
These are intended to be promoted to the full recipes table once additional details are added.';

COMMENT
on column recipe_suggestions.promoted_to_recipe_id is
'Reference to the recipe that was created from this suggestion. NULL if not yet promoted.';

COMMENT
on column recipe_suggestions.promoted_at is
'Timestamp when this suggestion was promoted to a full recipe. NULL if not yet promoted.';

-- Indexes for common queries
create index idx_recipe_suggestions_difficulty on recipe_suggestions (difficulty);

create index idx_recipe_suggestions_created_at on recipe_suggestions (created_at);

create index idx_recipe_suggestions_promoted on recipe_suggestions (promoted_to_recipe_id);

-- Row level security policies
alter table recipe_suggestions enable row level security;

create
policy "public_read"
    on recipe_suggestions for
select using (true);

create
policy "public_insert"
    on recipe_suggestions for insert
    with check (true);

create
policy "public_update"
    on recipe_suggestions for
update using (true);

create
policy "public_delete"
    on recipe_suggestions for delete
using (true);
