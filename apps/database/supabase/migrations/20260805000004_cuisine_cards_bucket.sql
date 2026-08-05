-- The tinted cuisine collection cards below the Explore banner, written by
-- `operations/generate-cuisine-cards.ts`.
--
-- A third cuisine asset, and the third shape: `cuisine_images` is a square tile,
-- `cuisine_banners` is a 1.9:1 strip with its left side empty, and these are 4:3
-- illustrations painted on a *tinted* ground so they can sit flush in a coloured
-- card. None is derivable from the others by cropping — each is composed for the
-- box it lives in.
--
-- Public-read like the other image buckets: served straight to the app, and the
-- upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('cuisine_cards', 'cuisine_cards', true)
on conflict (id) do nothing;

create policy public_read_cuisine_cards on storage.objects for select
    using ((bucket_id = 'cuisine_cards'::text));
