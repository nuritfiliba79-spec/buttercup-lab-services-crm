-- When each user last opened each project. Files uploaded by someone else after that
-- moment are shown as "new" (📎 חדש) in lists, on the dashboard and on the project page.
create table public.project_views (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.project_views enable row level security;

create policy "own project views" on public.project_views for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and project_id in (select id from public.projects));

create index attachments_project_created_idx on public.attachments(project_id, created_at desc);
