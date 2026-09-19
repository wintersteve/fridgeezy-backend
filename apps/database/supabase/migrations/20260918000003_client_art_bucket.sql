-- The bucket behind the app's fixed illustrations — the paintings that belong
-- to a SCREEN rather than to a dish.
--
-- Three state paintings (`bowl`, `plate`, `produce`, drawn as discs by
-- `ArtMedallion` on locked and empty pages) and the compose-menu card's band.
-- All four are painted once by `generate-client-art` and change about as often
-- as the app's icon does, which is why they are seeded rather than generated on
-- demand like a technique plate.
--
-- **What is deliberately NOT here: the five crash paintings.** `ErrorState`'s
-- `crash` kind draws one of them when a screen has thrown, and a picture shown
-- because something broke must not itself need a working network — a crash and
-- a dead connection arrive together often enough that the one illustration in
-- the app which cannot be allowed to fail is that one. Those five stay in the
-- binary.
--
-- Public-read like the other generated-asset buckets: served straight to the
-- app, and the upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('client_art', 'client_art', true)
on conflict (id) do nothing;

create policy public_read_client_art on storage.objects for select
    using ((bucket_id = 'client_art'::text));
