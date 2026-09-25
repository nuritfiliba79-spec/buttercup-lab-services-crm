-- =====================================================================
-- Four roles, enforced with RLS:
--   admin        מנהל מערכת  – sees and manages everything, incl. deletes and users
--   lab_manager  מנהל מעבדה  – manages operational data (no deletes of core records, no users)
--   technician   מבצע בדיקות – sees requests that include tests at their lab; updates
--                              status / performer / results of their lab's tests,
--                              adds report notes and uploads result files
--   client       לקוח        – read-only access to their own company's projects
-- =====================================================================

-- ---------- profiles: new roles + lab assignment ----------
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'admin' where role = 'staff';
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'lab_manager', 'technician', 'client')),
  add column lab_id uuid references public.labs(id) on delete set null;

-- ---------- Role helpers (security definer: owner bypasses RLS, so no recursion) ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()) = any(roles), false)
$$;

create or replace function public.my_lab_id()
returns uuid language sql stable security definer set search_path = public as $$
  select lab_id from profiles where id = auth.uid()
$$;

-- kept for older code paths: "can manage operational data"
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin', 'lab_manager')
$$;

-- Technician scope: requests that contain at least one test at the technician's lab.
create or replace function public.tech_request_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct t.test_request_id from tests t
  where t.lab_id = public.my_lab_id() and public.my_role() = 'technician'
$$;

create or replace function public.tech_project_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct tr.project_id from test_requests tr where tr.id in (select public.tech_request_ids())
$$;

create or replace function public.tech_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.client_id from projects p where p.id in (select public.tech_project_ids())
$$;

-- ---------- Drop every existing policy on the app tables, then rebuild ----------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('labs','clients','projects','project_labs','test_requests','tests','reports','attachments','profiles')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- labs
create policy "labs read"    on public.labs for select to authenticated using (true);
create policy "labs insert"  on public.labs for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "labs update"  on public.labs for update to authenticated using (public.has_role('admin','lab_manager')) with check (public.has_role('admin','lab_manager'));
create policy "labs delete"  on public.labs for delete to authenticated using (public.has_role('admin'));

-- clients
create policy "clients read" on public.clients for select to authenticated using (
  public.has_role('admin','lab_manager')
  or id = public.my_client_id()
  or id in (select public.tech_client_ids()));
create policy "clients insert" on public.clients for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "clients update" on public.clients for update to authenticated using (public.has_role('admin','lab_manager')) with check (public.has_role('admin','lab_manager'));
create policy "clients delete" on public.clients for delete to authenticated using (public.has_role('admin'));

-- projects
create policy "projects read" on public.projects for select to authenticated using (
  public.has_role('admin','lab_manager')
  or client_id = public.my_client_id()
  or id in (select public.tech_project_ids()));
create policy "projects insert" on public.projects for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "projects update" on public.projects for update to authenticated using (public.has_role('admin','lab_manager')) with check (public.has_role('admin','lab_manager'));
create policy "projects delete" on public.projects for delete to authenticated using (public.has_role('admin'));

-- project_labs (managers replace the whole set when editing a project, so they may delete rows)
create policy "project_labs read" on public.project_labs for select to authenticated using (
  public.has_role('admin','lab_manager')
  or project_id in (select public.my_project_ids())
  or project_id in (select public.tech_project_ids()));
create policy "project_labs insert" on public.project_labs for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "project_labs delete" on public.project_labs for delete to authenticated using (public.has_role('admin','lab_manager'));

-- test_requests
create policy "requests read" on public.test_requests for select to authenticated using (
  public.has_role('admin','lab_manager')
  or id in (select public.my_request_ids())
  or id in (select public.tech_request_ids()));
create policy "requests insert" on public.test_requests for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "requests update" on public.test_requests for update to authenticated using (public.has_role('admin','lab_manager')) with check (public.has_role('admin','lab_manager'));
create policy "requests delete" on public.test_requests for delete to authenticated using (public.has_role('admin'));

-- tests
create policy "tests read" on public.tests for select to authenticated using (
  public.has_role('admin','lab_manager')
  or test_request_id in (select public.my_request_ids())
  or test_request_id in (select public.tech_request_ids()));
create policy "tests insert" on public.tests for insert to authenticated with check (public.has_role('admin','lab_manager'));
create policy "tests update" on public.tests for update to authenticated
  using (public.has_role('admin','lab_manager') or (public.my_role() = 'technician' and lab_id = public.my_lab_id()))
  with check (public.has_role('admin','lab_manager') or (public.my_role() = 'technician' and lab_id = public.my_lab_id()));
create policy "tests delete" on public.tests for delete to authenticated using (public.has_role('admin'));

-- reports (rows are created/maintained by triggers; people only edit notes)
create policy "reports read" on public.reports for select to authenticated using (
  public.has_role('admin','lab_manager')
  or test_request_id in (select public.my_request_ids())
  or test_request_id in (select public.tech_request_ids()));
create policy "reports update" on public.reports for update to authenticated
  using (public.has_role('admin','lab_manager') or test_request_id in (select public.tech_request_ids()))
  with check (public.has_role('admin','lab_manager') or test_request_id in (select public.tech_request_ids()));
create policy "reports delete" on public.reports for delete to authenticated using (public.has_role('admin'));

-- attachments
create policy "attachments read" on public.attachments for select to authenticated using (
  public.has_role('admin','lab_manager')
  or project_id in (select public.my_project_ids())
  or project_id in (select public.tech_project_ids()));
create policy "attachments insert" on public.attachments for insert to authenticated with check (
  public.has_role('admin','lab_manager')
  or (public.my_role() = 'technician' and project_id in (select public.tech_project_ids())));
create policy "attachments delete" on public.attachments for delete to authenticated using (public.has_role('admin'));

-- profiles
create policy "profiles read"   on public.profiles for select to authenticated using (id = auth.uid() or public.has_role('admin'));
create policy "profiles update" on public.profiles for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "profiles delete" on public.profiles for delete to authenticated using (public.has_role('admin'));

-- ---------- Column guards (RLS is row-level; these limit what a technician may change) ----------
create or replace function public.guard_technician_test_update()
returns trigger language plpgsql as $$
begin
  if public.my_role() = 'technician'
     and (new.test_type, new.lab_id, new.due_date, new.test_request_id)
         is distinct from (old.test_type, old.lab_id, old.due_date, old.test_request_id) then
    raise exception 'מבצע בדיקות יכול לעדכן רק סטטוס, מבצע ותוצאה' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tests_guard_technician before update on public.tests
  for each row execute function public.guard_technician_test_update();

create or replace function public.guard_technician_report_update()
returns trigger language plpgsql as $$
begin
  -- refresh_report() marks its own updates so the recalculated columns are allowed.
  if public.my_role() = 'technician'
     and coalesce(current_setting('app.system_update', true), '') <> 'on'
     and (new.status, new.all_tests_done, new.total_tests, new.completed_tests, new.message, new.generated_at, new.test_request_id)
         is distinct from (old.status, old.all_tests_done, old.total_tests, old.completed_tests, old.message, old.generated_at, old.test_request_id) then
    raise exception 'מבצע בדיקות יכול לעדכן רק הערות בדוח' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reports_guard_technician before update on public.reports
  for each row execute function public.guard_technician_report_update();

create or replace function public.refresh_report(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total     int;
  v_completed int;
  v_started   int;
  v_done      boolean;
  v_status    public.report_status;
  v_message   text;
begin
  if p_request_id is null or not exists (select 1 from test_requests where id = p_request_id) then
    return;
  end if;
  perform set_config('app.system_update', 'on', true);

  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status = 'completed'),
         count(*) filter (where status in ('in_progress', 'completed', 'failed'))
    into v_total, v_completed, v_started
    from tests where test_request_id = p_request_id;

  v_done := v_total > 0 and v_completed = v_total;
  v_status := case when v_done then 'completed'
                   when v_started > 0 then 'in_progress'
                   else 'pending' end;
  v_message := case when v_total = 0 then 'לא הוגדרו בדיקות'
                    when v_done then 'כל הבדיקות בוצעו - הדוח מוכן'
                    else format('בוצעו %s מתוך %s בדיקות', v_completed, v_total) end;

  insert into reports (test_request_id, status, all_tests_done, total_tests, completed_tests, message, generated_at)
  values (p_request_id, v_status, v_done, v_total, v_completed, v_message, case when v_done then now() end)
  on conflict (test_request_id) do update
    set status          = excluded.status,
        all_tests_done  = excluded.all_tests_done,
        total_tests     = excluded.total_tests,
        completed_tests = excluded.completed_tests,
        message         = excluded.message,
        generated_at    = case when excluded.all_tests_done
                               then coalesce(reports.generated_at, now()) end;

  update test_requests set tests_completed = v_done
   where id = p_request_id and tests_completed is distinct from v_done;

  perform set_config('app.system_update', 'off', true);
end;
$$;

-- ---------- New users / admin-provisioned metadata ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app  jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_client_id uuid;
begin
  if nullif(trim(meta->>'company_name'), '') is not null then
    insert into clients (name, contact_person, phone, email)
    values (trim(meta->>'company_name'), nullif(trim(meta->>'contact_person'), ''),
            nullif(trim(meta->>'phone'), ''), new.email)
    returning id into v_client_id;
  end if;

  insert into profiles (id, role, client_id, full_name, must_change_password)
  values (
    new.id,
    case when app->>'role' in ('admin', 'lab_manager', 'technician', 'client') then app->>'role' else 'client' end,
    v_client_id,
    coalesce(nullif(trim(meta->>'contact_person'), ''), nullif(trim(meta->>'full_name'), '')),
    coalesce((app->>'must_change_password')::boolean, false)
  );
  return new;
end;
$$;

create or replace function public.sync_profile_from_app_metadata()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  update profiles set
    role = case when app->>'role' in ('admin', 'lab_manager', 'technician', 'client') then app->>'role' else role end,
    must_change_password = coalesce((app->>'must_change_password')::boolean, must_change_password)
  where id = new.id;
  return new;
end;
$$;

-- ---------- Storage (files live at projects/<project_id>/<file>) ----------
drop policy if exists "lab-files staff all"   on storage.objects;
drop policy if exists "lab-files client read" on storage.objects;

create policy "lab-files read" on storage.objects for select to authenticated using (
  bucket_id = 'lab-files' and (
    public.has_role('admin','lab_manager')
    or (storage.foldername(name))[2] in (select id::text from public.my_project_ids() as id)
    or (storage.foldername(name))[2] in (select id::text from public.tech_project_ids() as id)));
create policy "lab-files insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'lab-files' and (
    public.has_role('admin','lab_manager')
    or (public.my_role() = 'technician'
        and (storage.foldername(name))[2] in (select id::text from public.tech_project_ids() as id))));
create policy "lab-files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'lab-files' and public.has_role('admin'));
