-- Create storage bucket for cuisines images
insert into storage.buckets (id, name, public)
values ('recipes', 'recipes', true) on conflict (id) do nothing;

-- Enable RLS on the bucket
create
policy "recipes_public_read"
on storage.objects for
select using (bucket_id = 'cuisine_images');