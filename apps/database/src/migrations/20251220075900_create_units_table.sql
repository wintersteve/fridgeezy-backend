create type unit_system as enum ('metric', 'imperial', 'universal');
create type unit_type as enum ('weight', 'volume', 'count');

create table units
(
    id                UUID primary key     default gen_random_uuid(),
    name              TEXT        not null unique,
    abbreviation      TEXT        not null unique,
    system            unit_system not null,
    type              unit_type   not null,
    base_unit_id      UUID references units (id),
    conversion_factor DECIMAL(20, 10),
    created_at        TIMESTAMPTZ not null default now()
);

comment on column units.base_unit_id is 'Reference to the base unit for this type (e.g., grams for weight, milliliters for volume)';
comment on column units.conversion_factor is 'Factor to multiply by to convert to base unit';

create index idx_units_system on units (system);
create index idx_units_type on units (type);

alter table units enable row level security;

create policy "public_read" on units for select using (true);
