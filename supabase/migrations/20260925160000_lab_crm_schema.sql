-- =====================================================================
-- Buttercum Lab Services CRM - core schema
-- clients -> projects -> test_requests -> tests
--                              \-> reports (auto-updated, realtime)
-- attachments (drawings / images / COA) stored in bucket "lab-files"
-- =====================================================================

-- ---------- Enums ----------
create type public.test_status as enum ('pending', 'in_progress', 'completed', 'failed', 'cancelled');
create type public.report_status as enum ('pending', 'in_progress', 'completed');
create type public.attachment_type as enum ('drawing', 'image', 'coa', 'other');

-- ---------- Helpers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create sequence public.project_number_seq;
create sequence public.request_number_seq;

-- ---------- Labs (מעבדות) ----------
create table public.labs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  contact     text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);

-- ---------- Clients (לקוחות) ----------
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,             -- שם הלקוח
  contact_person  text,                      -- איש קשר
  phone           text,                      -- טלפון
  email           text,                      -- מייל
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- Projects (פרויקטים) ----------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  project_number  text not null unique
                  default 'PRJ-' || lpad(nextval('public.project_number_seq')::text, 5, '0'),  -- מספר פרויקט
  client_id       uuid not null references public.clients(id) on delete restrict,             -- משויך ללקוח
  name            text,
  requirements    text,                      -- מה נדרש בפרויקט
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index projects_client_id_idx on public.projects(client_id);

-- Labs required for each project (איזו מעבדה נדרשת)
create table public.project_labs (
  project_id  uuid not null references public.projects(id) on delete cascade,
  lab_id      uuid not null references public.labs(id) on delete restrict,
  primary key (project_id, lab_id)
);

-- ---------- Test requests (הזמנות בדיקה) ----------
create table public.test_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_number      text not null unique
                      default 'REQ-' || lpad(nextval('public.request_number_seq')::text, 5, '0'),  -- מספר בדיקות
  project_id          uuid not null references public.projects(id) on delete cascade,
  special_notes       text,                  -- הערות מיוחדות
  storage_conditions  text,                  -- תנאי אחסון
  test_date           date,                  -- תאריך בדיקה
  tests_completed     boolean not null default false,  -- האם בוצעו הבדיקות (מתעדכן אוטומטית)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index test_requests_project_id_idx on public.test_requests(project_id);

-- ---------- Tests (בדיקות) ----------
create table public.tests (
  id               uuid primary key default gen_random_uuid(),
  test_request_id  uuid not null references public.test_requests(id) on delete cascade,
  test_type        text not null,           -- סוג בדיקה
  lab_id           uuid references public.labs(id) on delete set null,  -- איזו מעבדה מבצעת
  performed_by     text,                    -- מי ביצע
  due_date         date,                    -- יעד
  status           public.test_status not null default 'pending',  -- סטטוס
  result_notes     text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index tests_test_request_id_idx on public.tests(test_request_id);
create index tests_lab_id_idx on public.tests(lab_id);

-- ---------- Reports (דוחות) - one per test request, kept in sync automatically ----------
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  test_request_id  uuid not null unique references public.test_requests(id) on delete cascade,
  status           public.report_status not null default 'pending',  -- סטטוס בדיקות
  all_tests_done   boolean not null default false,                    -- האם בוצעו כל הבדיקות
  total_tests      int not null default 0,
  completed_tests  int not null default 0,
  message          text,                                              -- הודעה (נוצרת אוטומטית)
  notes            text,                                              -- הערות (ידני)
  generated_at     timestamptz,                                       -- מתי הדוח הושלם
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- Attachments (שרטוטים / תמונות / COA) ----------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  file_type        public.attachment_type not null,
  storage_path     text not null unique,   -- path inside bucket "lab-files"
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint,
  project_id       uuid references public.projects(id) on delete cascade,
  test_request_id  uuid references public.test_requests(id) on delete cascade,
  test_id          uuid references public.tests(id) on delete cascade,
  uploaded_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint attachments_has_owner check (num_nonnulls(project_id, test_request_id, test_id) >= 1)
);
create index attachments_project_id_idx on public.attachments(project_id);
create index attachments_test_request_id_idx on public.attachments(test_request_id);
create index attachments_test_id_idx on public.attachments(test_id);

-- ---------- updated_at triggers ----------
create trigger clients_updated_at       before update on public.clients       for each row execute function public.set_updated_at();
create trigger projects_updated_at      before update on public.projects      for each row execute function public.set_updated_at();
create trigger test_requests_updated_at before update on public.test_requests for each row execute function public.set_updated_at();
create trigger tests_updated_at         before update on public.tests         for each row execute function public.set_updated_at();
create trigger reports_updated_at       before update on public.reports       for each row execute function public.set_updated_at();

-- Stamp completed_at when a test is marked completed
create or replace function public.tests_stamp_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tests_completed_at before insert or update of status on public.tests
  for each row execute function public.tests_stamp_completed();

-- ---------- Report sync logic ----------
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

  -- cancelled tests are not counted
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
end;
$$;

create or replace function public.tests_sync_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform refresh_report(new.test_request_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.test_request_id <> new.test_request_id) then
    perform refresh_report(old.test_request_id);
  end if;
  return null;
end;
$$;
create trigger tests_sync_report after insert or update or delete on public.tests
  for each row execute function public.tests_sync_report();

create or replace function public.test_requests_create_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_report(new.id);
  return null;
end;
$$;
create trigger test_requests_create_report after insert on public.test_requests
  for each row execute function public.test_requests_create_report();

-- ---------- Row Level Security: signed-in staff get full access ----------
do $$
declare t text;
begin
  foreach t in array array['labs','clients','projects','project_labs','test_requests','tests','reports','attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.reports, public.tests, public.test_requests;

-- ---------- Storage bucket for drawings / images / COA ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lab-files', 'lab-files', false, 52428800,
        array['image/*', 'application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/acad', 'image/vnd.dwg', 'application/dxf', 'application/octet-stream'])
on conflict (id) do nothing;

create policy "lab-files read"   on storage.objects for select to authenticated using (bucket_id = 'lab-files');
create policy "lab-files upload" on storage.objects for insert to authenticated with check (bucket_id = 'lab-files');
create policy "lab-files update" on storage.objects for update to authenticated using (bucket_id = 'lab-files');
create policy "lab-files delete" on storage.objects for delete to authenticated using (bucket_id = 'lab-files');
