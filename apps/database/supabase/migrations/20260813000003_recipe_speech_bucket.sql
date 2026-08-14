-- The bucket behind cook mode's read-aloud clips, written by
-- `apps/api/src/modules/speech/services/get-or-synthesize-speech.ts`.
--
-- One object per distinct step text (named by its sha256), not per recipe or
-- step number: text is what a TTS call actually depends on, and keying on it
-- directly means two users reading the same step — or two recipes that happen
-- to share a sentence — hit the same cached clip for free, with no separate
-- invalidation to get wrong if an instruction is edited later.
--
-- Public-read like the other generated-asset buckets: served straight to the
-- app, and the upload path runs with the service role, which bypasses RLS.
insert into storage.buckets (id, name, public)
values ('recipe_speech', 'recipe_speech', true)
on conflict (id) do nothing;

create policy public_read_recipe_speech on storage.objects for select
    using ((bucket_id = 'recipe_speech'::text));
