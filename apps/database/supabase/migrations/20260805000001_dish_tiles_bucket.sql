-- The bucket behind the compose card, written by
-- `operations/generate-dish-tiles.ts`.
--
-- Supersedes `ingredient_tiles`, created a day earlier in
-- 20260805000000_ingredient_tiles_bucket.sql. That name was wrong twice over by
-- the time anything shipped: the assets became plated dishes rather than raw
-- ingredients, and they are now read by the suggestion cards' "no photo yet"
-- state as well as by the compose card, so nothing about "ingredient tiles"
-- described either the content or the callers.
--
-- Storage buckets cannot be renamed in place — `storage.objects` keys on
-- `bucket_id` — so this creates the new one and the objects are copied across
-- out of band. The old bucket is deliberately left in place: dropping it would
-- break any client still holding the previous URLs, and it costs nothing to
-- keep until those have aged out. Drop it in a later migration.
--
-- Public-read like the other image buckets: these are served straight to the
-- app, and the upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('dish_tiles', 'dish_tiles', true)
on conflict (id) do nothing;

create policy public_read_dish_tiles on storage.objects for select
    using ((bucket_id = 'dish_tiles'::text));
