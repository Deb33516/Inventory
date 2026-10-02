-- 0016_brand_assets_logo.sql
-- Add logo_url to public.app_settings
alter table public.app_settings
  add column if not exists logo_url text;

-- Create brand-assets public storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- Storage RLS policies for brand-assets
-- 1. Public SELECT for reading brand assets
drop policy if exists "brand_assets_public_select" on storage.objects;
create policy "brand_assets_public_select"
  on storage.objects for select
  to public
  using (bucket_id = 'brand-assets');

-- 2. Super Admin only INSERT
drop policy if exists "brand_assets_super_admin_insert" on storage.objects;
create policy "brand_assets_super_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-assets'
    and private.current_role() = 'super_admin'::public.user_role
  );

-- 3. Super Admin only UPDATE
drop policy if exists "brand_assets_super_admin_update" on storage.objects;
create policy "brand_assets_super_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and private.current_role() = 'super_admin'::public.user_role
  )
  with check (
    bucket_id = 'brand-assets'
    and private.current_role() = 'super_admin'::public.user_role
  );

-- 4. Super Admin only DELETE
drop policy if exists "brand_assets_super_admin_delete" on storage.objects;
create policy "brand_assets_super_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and private.current_role() = 'super_admin'::public.user_role
  );
