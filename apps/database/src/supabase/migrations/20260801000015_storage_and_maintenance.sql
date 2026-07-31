-- Storage buckets, their policies, and the scheduled maintenance job.

-- All four are public-read: images are served straight to the app, and the
-- upload paths run with the service role, which bypasses RLS anyway.
insert into storage.buckets (id, name, public)
values ('recipes', 'recipes', true),
       ('category_images', 'category_images', true),
       ('cuisine_images', 'cuisine_images', true),
       ('cooking_actions_images', 'cooking_actions_images', true)
on conflict (id) do nothing;

create policy "Public read access" on storage.objects for select
    using ((bucket_id = 'category_images'::text));

create policy "Authenticated users can upload category images" on storage.objects for insert
    with check (((bucket_id = 'category_images'::text) and (auth.role() = 'authenticated'::text)));

create policy "Authenticated users can update category images" on storage.objects for update
    using (((bucket_id = 'category_images'::text) and (auth.role() = 'authenticated'::text)));

create policy "Authenticated users can delete category images" on storage.objects for delete
    using (((bucket_id = 'category_images'::text) and (auth.role() = 'authenticated'::text)));

create policy public_read on storage.objects for select
    using ((bucket_id = 'cuisine_images'::text));

create policy public_read_cooking_actions_images on storage.objects for select
    using ((bucket_id = 'cooking_actions_images'::text));

-- Reaps generated recipes nobody kept: older than 30 days, not saved to a
-- collection or shopping list, never interacted with, and not the base of a
-- variant. Generation is cheap to redo and these accumulate fast.
create or replace function public.delete_orphan_generated_recipes()
    returns integer
    language plpgsql
as $function$
declare
    v_deleted INTEGER;
begin
    WITH removed AS (
        DELETE FROM recipes r
        WHERE r.is_generated = true
          AND r.created_at < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM recipe_variants v WHERE v.recipe_id = r.id OR v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipes v WHERE v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM profile_recipe_interactions pri WHERE pri.recipe_id = r.id)
        RETURNING r.id
    )
    SELECT count(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
end;
$function$;

select cron.schedule('delete-orphan-generated-recipes', '0 3 * * *',
                     'SELECT delete_orphan_generated_recipes();');
