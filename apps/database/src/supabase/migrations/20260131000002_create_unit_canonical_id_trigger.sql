-- Trigger to auto-generate canonical_id on units insert/update
-- Ensures consistent normalization across all units

CREATE OR REPLACE FUNCTION set_unit_canonical_id()
RETURNS TRIGGER AS $$
BEGIN
    -- Normalize: lowercase, replace non-alphanumeric with underscore, remove leading/trailing underscores
    NEW.canonical_id := regexp_replace(
        regexp_replace(lower(trim(NEW.name)), '[^a-z0-9]+', '_', 'g'),
        '^_|_$', '', 'g'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_unit_canonical_id_trigger
    BEFORE INSERT OR UPDATE OF name ON units
    FOR EACH ROW
    EXECUTE FUNCTION set_unit_canonical_id();

COMMENT ON FUNCTION set_unit_canonical_id() IS 'Generates canonical_id from unit name for consistent matching.';
