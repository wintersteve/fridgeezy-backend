-- Drop two storage buckets that were created and never used.
--
-- Both come from `20260801000015_storage_and_maintenance.sql` and neither has
-- ever held an object or been named by a line of code outside the migration
-- that created it:
--
--   * `category_images` — ingredient-category pictures, for a surface that was
--     never built. The category tiles draw glyphs, not images.
--   * `cooking_actions_images` — pictures for `cooking_actions` rows. That
--     feature exists now and lives in `technique_art` (see
--     `20260917000002_technique_art_bucket.sql`), which was created without
--     anyone noticing this empty one had been waiting for it since August.
--
-- The second is why this is worth a migration rather than leaving two harmless
-- empty buckets alone: a reader looking for where technique art lives would
-- find two plausible names and no way to tell which is real.
--
-- `cuisine_images`, created in that same statement, is already gone — the
-- cuisine art lives in `cuisine_cards` and `cuisine_banners`. Nothing here
-- touches it.
--
-- Policies go first: a policy is not dropped with its bucket, and one left
-- behind names a `bucket_id` that no longer exists. The names are verbatim from
-- the migration that created them — "Public read access" is generic but is
-- scoped to `category_images` alone.
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Authenticated users can upload category images" on storage.objects;
drop policy if exists "Authenticated users can update category images" on storage.objects;
drop policy if exists "Authenticated users can delete category images" on storage.objects;
drop policy if exists public_read_cooking_actions_images on storage.objects;

-- Safe on a stack where somebody has since put an object in one: this deletes
-- only what is genuinely empty, so a bucket in use survives with its policy
-- already dropped — noisy, but it fails visibly rather than deleting data.
delete from storage.buckets
where id in ('category_images', 'cooking_actions_images')
  and not exists (
      select 1 from storage.objects where objects.bucket_id = buckets.id
  );
