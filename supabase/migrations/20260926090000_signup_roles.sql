-- =====================================================================
-- Sign-up + roles
-- Every auth user gets a profile. Self sign-ups are customers ("client"):
-- the sign-up form's company details create a clients row linked to them,
-- and they can only READ their own company's data. Staff keep full access.
-- =====================================================================

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'client' check (role in ('staff', 'client')),
  client_id   uuid references public.clients(id) on delete set null,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- ---------- Role helpers (security definer so policies don't recurse through RLS) ----------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'staff')
$$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from profiles where id = auth.uid()
$$;

create or replace function public.my_project_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from projects p
  join profiles pr on pr.client_id = p.client_id
  where pr.id = auth.uid()
$$;

create or replace function public.my_request_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tr.id from test_requests tr where tr.project_id in (select public.my_project_ids())
$$;

-- ---------- New auth user -> profile (+ client company from sign-up metadata) ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_client_id uuid;
begin
  if nullif(trim(meta->>'company_name'), '') is not null then
    insert into clients (name, contact_person, phone, email)
    values (trim(meta->>'company_name'), nullif(trim(meta->>'contact_person'), ''),
            nullif(trim(meta->>'phone'), ''), new.email)
    returning id into v_client_id;
  end if;

  insert into profiles (id, role, client_id, full_name)
  values (new.id, 'client', v_client_id, nullif(trim(meta->>'contact_person'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing users (created before this migration) are lab staff.
insert into public.profiles (id, role)
select id, 'staff' from auth.users
on conflict (id) do nothing;

-- ---------- Replace "any signed-in user" policies with role-based ones ----------
do $$
declare t text;
begin
  foreach t in array array['labs','clients','projects','project_labs','test_requests','tests','reports','attachments'] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('create policy "staff full access" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

create policy "client reads labs"          on public.labs          for select to authenticated using (true);
create policy "client reads own company"   on public.clients       for select to authenticated using (id = public.my_client_id());
create policy "client reads own projects"  on public.projects      for select to authenticated using (client_id = public.my_client_id());
create policy "client reads project labs"  on public.project_labs  for select to authenticated using (project_id in (select public.my_project_ids()));
create policy "client reads own requests"  on public.test_requests for select to authenticated using (project_id in (select public.my_project_ids()));
create policy "client reads own tests"     on public.tests         for select to authenticated using (test_request_id in (select public.my_request_ids()));
create policy "client reads own reports"   on public.reports       for select to authenticated using (test_request_id in (select public.my_request_ids()));
create policy "client reads own files"     on public.attachments   for select to authenticated using (project_id in (select public.my_project_ids()));

alter table public.profiles enable row level security;
create policy "read own profile"      on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "staff manage profiles" on public.profiles for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- Storage: staff full access, clients read files of their own projects ----------
drop policy if exists "lab-files read"   on storage.objects;
drop policy if exists "lab-files upload" on storage.objects;
drop policy if exists "lab-files update" on storage.objects;
drop policy if exists "lab-files delete" on storage.objects;

create policy "lab-files staff all" on storage.objects for all to authenticated
  using (bucket_id = 'lab-files' and public.is_staff())
  with check (bucket_id = 'lab-files' and public.is_staff());

-- Files are stored as projects/<project_id>/<file>
create policy "lab-files client read" on storage.objects for select to authenticated
  using (bucket_id = 'lab-files'
         and (storage.foldername(name))[2] in (select id::text from public.my_project_ids() as id));
