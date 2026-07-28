-- Add an optional icon to collections so users can distinguish them visually.
-- Stores a Material Community Icons name (e.g. "silverware-fork-knife"); null
-- falls back to the default folder icon in the app.
ALTER TABLE collections ADD COLUMN icon TEXT;
