-- The wide Explore-Cuisine banners on the home feed, written by
-- `operations/generate-cuisine-banners.ts`.
--
-- Separate from `cuisine_images` rather than a second size in it, because the
-- two are composed differently and neither can be derived from the other: a
-- square tile centres its dish, and centre-cropping that to a 1.9:1 banner puts
-- a bowl exactly where the cuisine's name goes. The banners are generated 16:9
-- with their left third deliberately empty so the copy has unbroken ground.
--
-- Public-read like the other image buckets: served straight to the app, and the
-- upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('cuisine_banners', 'cuisine_banners', true)
on conflict (id) do nothing;

create policy public_read_cuisine_banners on storage.objects for select
    using ((bucket_id = 'cuisine_banners'::text));
