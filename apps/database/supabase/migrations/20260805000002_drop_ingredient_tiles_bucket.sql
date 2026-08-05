-- Drops `ingredient_tiles`, superseded by `dish_tiles` in
-- 20260805000001_dish_tiles_bucket.sql and emptied of its objects.
--
-- Additive rather than a rewrite of 20260805000000, which created it: that
-- migration has been applied, and editing an applied migration desyncs every
-- database that already ran it. On a fresh reset this schema now creates the
-- bucket and drops it again a moment later, which is the honest record — the
-- bucket existed, briefly, and its name was wrong.
--
-- 20260805000001 said the old bucket would stand "until any client holding the
-- previous URLs has aged out". That reasoning expired the moment its objects
-- were deleted: those URLs already fail, so keeping an empty bucket bought
-- nothing but a second place to look.
--
-- The policy goes first — a bucket row cannot be removed while a policy still
-- references it by id, and dropping the row without it would leave a rule that
-- can never match.
drop policy if exists public_read_ingredient_tiles on storage.objects;

-- Guarded rather than a bare delete: `storage.objects` has a foreign key onto
-- `storage.buckets`, so this fails loudly if anything was uploaded after the
-- prune rather than silently orphaning it.
delete from storage.buckets where id = 'ingredient_tiles';
