-- Create ingredient substitutes table (self-referential many-to-many)
-- Allows tracking which ingredients can substitute for others
create table ingredient_substitutes
(
    id            UUID primary key     default gen_random_uuid(),
    ingredient_id UUID        not null references ingredients (id) on delete cascade,
    substitute_id UUID        not null references ingredients (id) on delete cascade,
    notes         TEXT, -- Optional notes about the substitution (e.g., "use 1.5x amount")
    created_at    TIMESTAMPTZ not null default now(),
    unique (ingredient_id, substitute_id),
    check (ingredient_id != substitute_id
) -- Prevent self-substitution
    );

create index idx_ingredient_substitutes_ingredient_id on ingredient_substitutes (ingredient_id);

create index idx_ingredient_substitutes_substitute_id on ingredient_substitutes (substitute_id);

alter table ingredient_substitutes ENABLE row level security;

create
POLICY "public_read"
    on ingredient_substitutes for
select using (true);

create
POLICY "public_insert"
    on ingredient_substitutes for insert with check (true);
