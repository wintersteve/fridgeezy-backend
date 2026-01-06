-- Create storage bucket for cuisines images
insert into storage.buckets (id, name, public)
values ('cuisine_images', 'cuisine_images', true) on conflict (id) do nothing;

-- Enable RLS on the bucket
create
policy "public_read"
on storage.objects for
select using (bucket_id = 'cuisine_images');