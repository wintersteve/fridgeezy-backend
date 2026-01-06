-- Create storage bucket for category images
insert into storage.buckets (id, name, public)
values ('category_images', 'category_images', true) on conflict (id) do nothing;

-- Enable RLS on the bucket
create
policy "Public read access"
on storage.objects for
select using (bucket_id = 'category_images');

-- Allow authenticated uploads (you can adjust this based on your needs)
create
policy "Authenticated users can upload category images"
on storage.objects for insert
with check (bucket_id = 'category_images' and auth.role() = 'authenticated');

-- Allow authenticated users to update category images
create
policy "Authenticated users can update category images"
on storage.objects for
update using (bucket_id = 'category_images' and auth.role() = 'authenticated');

-- Allow authenticated users to delete category images
create
policy "Authenticated users can delete category images"
on storage.objects for delete
using (bucket_id = 'category_images' and auth.role() = 'authenticated');
