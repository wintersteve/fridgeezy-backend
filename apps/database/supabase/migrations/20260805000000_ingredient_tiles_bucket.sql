-- The bucket behind the home feed's compose card: one tall ingredient tile per
-- course, written by `operations/generate-ingredient-tiles.ts`.
--
-- Public-read like the other four image buckets — these are served straight to
-- the app, and the upload path runs with the service role, which bypasses RLS
-- anyway. No insert/update/delete policy for the same reason: nothing but the
-- service role ever writes here.
insert into storage.buckets (id, name, public)
values ('ingredient_tiles', 'ingredient_tiles', true)
on conflict (id) do nothing;

create policy public_read_ingredient_tiles on storage.objects for select
    using ((bucket_id = 'ingredient_tiles'::text));
