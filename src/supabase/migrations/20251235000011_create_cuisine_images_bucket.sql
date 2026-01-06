-- Create storage bucket for cuisines images
insert into storage.buckets (id, name, public)
values ('cooking_actions_images', 'cooking_actions_images', true) on conflict (id) do nothing;

-- Enable RLS on the bucket
create
policy "public_read_cooking_actions_images"
on storage.objects for
select using (bucket_id = 'cooking_actions_images');