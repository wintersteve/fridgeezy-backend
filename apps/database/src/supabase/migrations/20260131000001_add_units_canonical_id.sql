-- Add canonical_id column to units table for consistent matching
-- Following the same pattern as categories and ingredients

-- Add the column (nullable initially for population)
ALTER TABLE units ADD COLUMN canonical_id TEXT;

-- Populate canonical_id from existing unit names
-- Uses same normalization as normalize_to_canonical_id function
UPDATE units SET canonical_id = regexp_replace(
    regexp_replace(lower(trim(name)), '[^a-z0-9]+', '_', 'g'),
    '^_|_$', '', 'g'
);

-- Make column required after population
ALTER TABLE units ALTER COLUMN canonical_id SET NOT NULL;

-- Add unique constraint for lookups
ALTER TABLE units ADD CONSTRAINT units_canonical_id_unique UNIQUE (canonical_id);

-- Add index for fast lookups
CREATE INDEX idx_units_canonical_id ON units (canonical_id);

COMMENT ON COLUMN units.canonical_id IS 'Normalized identifier for consistent matching. Auto-generated from unit name via trigger.';
