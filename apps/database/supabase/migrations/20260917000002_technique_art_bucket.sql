-- The bucket behind the cooking-technique paintings, written by
-- `apps/api/src/modules/techniques/services/get-or-generate-technique-art.ts`.
--
-- One object per canonical `cooking_actions.name` — `grate.jpg`, `deglaze.jpg`
-- — and NOT per recipe, per step or per profile. A picture of grating is true
-- of every recipe that grates anything and of every reader who asks, so the
-- first person to ask a question about a verb pays for the image and everybody
-- after them gets a storage read. Same shape and same argument as
-- `recipe_speech`, with one property that bucket does not have: the vocabulary
-- here is CLOSED. `cooking_actions` holds ~148 rows, so the total this bucket
-- can ever cost is the whole table once, which is what makes the route free.
--
-- Public-read like the other generated-asset buckets: served straight to the
-- app, and the upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('technique_art', 'technique_art', true)
on conflict (id) do nothing;

create policy public_read_technique_art on storage.objects for select
    using ((bucket_id = 'technique_art'::text));
