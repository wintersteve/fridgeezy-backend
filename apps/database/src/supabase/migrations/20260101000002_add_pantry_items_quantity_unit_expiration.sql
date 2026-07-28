-- Add quantity, unit, and expiration tracking to pantry_items table
alter table pantry_items add column quantity DECIMAL(10, 3);
alter table pantry_items add column unit_id UUID references units (id) on delete set null;
alter table pantry_items add column expires_at TIMESTAMPTZ;

COMMENT on column pantry_items.quantity is
'Amount of ingredient in pantry. Nullable to allow tracking presence without specific quantity. Precision matches recipe_ingredients table.';

COMMENT on column pantry_items.unit_id is
'Unit of measurement for quantity. References units table. Nullable for items tracked without quantity.';

COMMENT on column pantry_items.expires_at is
'Expiration timestamp. Auto-calculated from ingredient defaults via trigger, or user-provided. NULL for non-expiring ingredients.';

-- Ensure quantity is positive if provided
alter table pantry_items add constraint pantry_items_quantity_positive
    check (quantity is null or quantity > 0);

-- Indexes for efficient queries
create index idx_pantry_items_unit_id on pantry_items (unit_id);

-- Partial index: only index pantry items that have expiration dates
create index idx_pantry_items_expires_at on pantry_items (expires_at)
    where expires_at is not null;
