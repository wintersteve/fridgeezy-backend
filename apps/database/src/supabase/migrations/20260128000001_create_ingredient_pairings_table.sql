-- Create ingredient pairings table (self-referential many-to-many)
-- Allows tracking which ingredients commonly pair well together
create table ingredient_pairings
(
    id                   UUID primary key     default gen_random_uuid(),
    ingredient_id        UUID        not null references ingredients (id) on delete cascade,
    paired_ingredient_id UUID        not null references ingredients (id) on delete cascade,
    notes                TEXT, -- Optional notes about the pairing (e.g., "Classic Italian combination")
    created_at           TIMESTAMPTZ not null default now(),
    unique (ingredient_id, paired_ingredient_id),
    check (ingredient_id != paired_ingredient_id) -- Prevent self-pairing
);

create index idx_ingredient_pairings_ingredient_id on ingredient_pairings (ingredient_id);

create index idx_ingredient_pairings_paired_ingredient_id on ingredient_pairings (paired_ingredient_id);

alter table ingredient_pairings ENABLE row level security;

create
POLICY "public_read"
    on ingredient_pairings for
select using (true);

create
POLICY "public_insert"
    on ingredient_pairings for insert with check (true);
