-- Drops `cuisine_images`, superseded by `cuisine_cards`
-- (20260805000004) and `cuisine_banners` (20260805000003).
--
-- It was the square 110pt browse tile the home feed used before the feed was
-- rebuilt around a portrait card and a wide banner. Both of those shapes are
-- their own bucket and their own generator; nothing in the client builds a
-- `cuisine_images/<label>.png` URL any more, and its generator
-- (`operations/generate-category-images.ts`) is deleted in the same change.
--
-- Additive rather than a rewrite of 20260801000015, which created it, for the
-- reason 20260805000002 gives: editing an applied migration desyncs every
-- database that already ran it. A fresh reset therefore creates this bucket and
-- drops it again a moment later, which is the honest record.
--
-- The policy goes first — a bucket row cannot be removed while a policy still
-- references it by id, and dropping the row without it would leave a rule that
-- can never match.
--
-- `public_read` is the bare name 20260801000015 gave the cuisine_images select
-- policy, before the later buckets settled on `public_read_<bucket>`. There are
-- a dozen policies called `public_read` in this schema, but this is the only one
-- on `storage.objects` — which is what makes the unqualified name safe to drop
-- here and worth never reusing.
drop policy if exists public_read on storage.objects;

-- Guarded rather than a bare delete, exactly as 20260805000002 is: the
-- foreign key from `storage.objects` makes a bucket that was written to again
-- fail loudly here instead of silently orphaning its objects, and the
-- insufficient_privilege arm is for hosted projects, which refuse direct writes
-- to the storage tables (SQLSTATE 42501) and would otherwise abort `migration
-- up` and block every later migration behind it.
--
-- On a hosted project the row therefore survives and the empty bucket has to go
-- through the Storage API or the dashboard — which is how the live dev project's
-- objects and bucket were removed on 2026-08-13.
do
$$
    begin
        delete from storage.buckets where id = 'cuisine_images';
    exception
        when insufficient_privilege then
            raise notice 'cuisine_images: storage tables are not writable here — remove the bucket via the Storage API';
    end
$$;
