-- The bucket holding the STYLE ANCHORS — the handful of finished illustrations
-- shown to the image model alongside the recipe prompt, so a new dish is drawn
-- in the same hand as the ones already approved.
--
-- Read by `apps/api/src/modules/recipes/services/style-anchors.ts`, which
-- fetches them once per execution environment.
--
-- ## Why storage rather than the bundle
--
-- These are a TASTE decision and they move. The set went from one picture to
-- two to three inside an hour the day it was built, each time because a dish
-- came back wrong in a way the existing anchors could not correct — the third
-- was added purely because neither of the first two showed a browned surface,
-- and so the prompt's "what they have in common is the style" was quietly
-- teaching paleness. Bundled as base64 that is a deploy each time, on top of
-- ~450 KB in a bundle whose cold start is already watched. Here it is an
-- upload.
--
-- ## Public, although nothing serves it
--
-- No client fetches these: they are an INPUT to generation, not an app asset.
-- Public-read matches every other generated-asset bucket and makes the current
-- set something anybody can look at from a URL, which matters for a decision
-- nobody can check by reading code.
insert into storage.buckets (id, name, public)
values ('art_direction', 'art_direction', true)
on conflict (id) do nothing;

create policy public_read_art_direction on storage.objects for select
    using ((bucket_id = 'art_direction'::text));
