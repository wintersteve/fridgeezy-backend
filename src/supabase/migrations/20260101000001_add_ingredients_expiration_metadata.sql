-- Add expiration metadata to ingredients table
alter table ingredients add column expires_by_default BOOLEAN not null default false;
alter table ingredients add column default_shelf_life_days INTEGER;

COMMENT on column ingredients.expires_by_default is
'Whether this ingredient typically has an expiration date. true = perishable (milk, eggs, produce), false = non-perishable (water, salt, dried spices)';

COMMENT on column ingredients.default_shelf_life_days is
'Default number of days until expiration for perishable ingredients. Only meaningful when expires_by_default = true. Examples: milk (7), eggs (21), lettuce (7)';

-- Ensure logical consistency between expires_by_default and default_shelf_life_days
alter table ingredients add constraint ingredients_shelf_life_check
    check (
        (expires_by_default = false and default_shelf_life_days is null) or
        (expires_by_default = true and default_shelf_life_days > 0)
    );

-- Index for filtering by expiration status
create index idx_ingredients_expires_by_default on ingredients (expires_by_default);
