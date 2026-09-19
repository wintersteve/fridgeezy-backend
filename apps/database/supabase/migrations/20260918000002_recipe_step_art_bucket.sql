-- The bucket behind cook mode's per-STEP illustrations.
--
-- One object per (recipe, step): `<recipe_id>/<step_number>.webp`. Keyed on the
-- recipe's UUID rather than on its name, which is what the technique and hero
-- buckets both do — and the difference is the point. A hero is a picture of a
-- DISH, so every copy of that dish shares it and a name is the right key. A step
-- picture is of one instruction in one method, and a variant rewrites the
-- method while keeping the name, so name-keyed step art would have a
-- dairy-free version overwriting the original's steps one by one.
--
-- Public-read like the other generated-asset buckets: served straight to the
-- app, and the upload path runs with the service role, which bypasses RLS.
--
-- **Nothing writes to this unless `RECIPE_STEP_ART_ENABLED` is set**, which it
-- is not. The bucket exists ahead of the switch so that turning it on is one
-- environment variable rather than a migration on a live stack; an empty bucket
-- costs nothing.
insert into storage.buckets (id, name, public)
values ('recipe_step_art', 'recipe_step_art', true)
on conflict (id) do nothing;

create policy public_read_recipe_step_art on storage.objects for select
    using ((bucket_id = 'recipe_step_art'::text));
