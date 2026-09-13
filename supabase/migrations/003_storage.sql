-- Supabase Storage uses its own schema. Apply after 001 and 002.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('equipment-images','equipment-images',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy hclab_admin_upload on storage.objects for insert to authenticated
with check(bucket_id='equipment-images' and public.is_admin());
create policy hclab_admin_delete on storage.objects for delete to authenticated
using(bucket_id='equipment-images' and public.is_admin());
create policy hclab_image_read on storage.objects for select to anon,authenticated
using(bucket_id='equipment-images');
