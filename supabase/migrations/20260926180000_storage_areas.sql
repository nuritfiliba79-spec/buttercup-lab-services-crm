-- =====================================================================
-- Storage areas per purpose (all private, files at projects/<project_id>/<file>):
--   lab-files       קבצי פרויקט      – drawings / images / COA from the lab   (staff upload)
--   client-uploads  קבצי הלקוח       – files customers send for their projects (client + staff upload)
--   lab-reports     דוחות מעבדה      – final / interim reports                 (lab manager + admin upload)
--   test-data       נתוני בדיקות     – raw test data & experiment files        (technician + staff upload)
--
-- Who can read:
--   admin / lab_manager – everything
--   technician          – all areas, for projects that include tests at their lab
--   client              – lab-files, client-uploads, lab-reports of their own projects
--                         (raw test data stays internal)
-- Delete: admin, or the person who uploaded the file.
-- =====================================================================

alter type public.attachment_type add value if not exists 'report';
alter type public.attachment_type add value if not exists 'test_data';
alter type public.attachment_type add value if not exists 'experiment';

alter table public.attachments
  add column bucket text not null default 'lab-files'
    check (bucket in ('lab-files', 'client-uploads', 'lab-reports', 'test-data'));
alter table public.attachments drop constraint attachments_storage_path_key;
alter table public.attachments add constraint attachments_bucket_path_key unique (bucket, storage_path);
create index attachments_bucket_idx on public.attachments(bucket);

-- ---------- Buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('client-uploads', 'client-uploads', false, 52428800, array[
    'image/*', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/acad', 'image/vnd.dwg', 'application/dxf', 'application/zip', 'application/octet-stream']),
  ('lab-reports', 'lab-reports', false, 52428800, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']),
  ('test-data', 'test-data', false, 104857600, array[
    'image/*', 'application/pdf', 'text/csv', 'text/plain', 'application/json', 'application/xml', 'text/xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
on conflict (id) do nothing;

-- ---------- Helpers ----------
-- Buckets a client may read.
create or replace function public.client_readable_bucket(b text)
returns boolean language sql immutable as $$
  select b in ('lab-files', 'client-uploads', 'lab-reports')
$$;

-- ---------- attachments RLS ----------
drop policy if exists "attachments read"   on public.attachments;
drop policy if exists "attachments insert" on public.attachments;
drop policy if exists "attachments delete" on public.attachments;

create policy "attachments read" on public.attachments for select to authenticated using (
  public.has_role('admin', 'lab_manager')
  or (project_id in (select public.my_project_ids()) and public.client_readable_bucket(bucket))
  or project_id in (select public.tech_project_ids()));

create policy "attachments insert" on public.attachments for insert to authenticated with check (
  (public.has_role('admin', 'lab_manager'))
  or (public.my_role() = 'client' and bucket = 'client-uploads'
      and project_id in (select public.my_project_ids()) and uploaded_by = auth.uid())
  or (public.my_role() = 'technician' and bucket = 'test-data'
      and project_id in (select public.tech_project_ids()) and uploaded_by = auth.uid()));

create policy "attachments delete" on public.attachments for delete to authenticated using (
  public.has_role('admin') or uploaded_by = auth.uid());

-- ---------- storage.objects RLS ----------
drop policy if exists "lab-files read"   on storage.objects;
drop policy if exists "lab-files insert" on storage.objects;
drop policy if exists "lab-files delete" on storage.objects;

create policy "crm files read" on storage.objects for select to authenticated using (
  bucket_id in ('lab-files', 'client-uploads', 'lab-reports', 'test-data') and (
    public.has_role('admin', 'lab_manager')
    or (public.client_readable_bucket(bucket_id)
        and (storage.foldername(name))[2] in (select id::text from public.my_project_ids() as id))
    or (storage.foldername(name))[2] in (select id::text from public.tech_project_ids() as id)));

create policy "crm files insert" on storage.objects for insert to authenticated with check (
  (bucket_id in ('lab-files', 'client-uploads', 'lab-reports', 'test-data') and public.has_role('admin', 'lab_manager'))
  or (bucket_id = 'client-uploads' and public.my_role() = 'client'
      and (storage.foldername(name))[2] in (select id::text from public.my_project_ids() as id))
  or (bucket_id = 'test-data' and public.my_role() = 'technician'
      and (storage.foldername(name))[2] in (select id::text from public.tech_project_ids() as id)));

create policy "crm files delete" on storage.objects for delete to authenticated using (
  bucket_id in ('lab-files', 'client-uploads', 'lab-reports', 'test-data')
  and (public.has_role('admin') or owner_id = auth.uid()::text));

-- New uploads show up live for everyone who can see them.
alter publication supabase_realtime add table public.attachments;
