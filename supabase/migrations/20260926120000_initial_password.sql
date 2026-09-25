-- =====================================================================
-- Initial passwords: users created by an admin get a one-time password
-- and must choose their own on first login.
-- =====================================================================

alter table public.profiles
  add column must_change_password boolean not null default false;

-- Called by the app right after the user sets a new password.
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;

revoke execute on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- Admin-created users can be provisioned from auth metadata:
--   app_metadata.role = 'staff' | 'client', app_metadata.must_change_password = true
-- (app_metadata is only writable with the service role, so users can't grant themselves staff.)
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
    case when app->>'role' = 'staff' then 'staff' else 'client' end,
    v_client_id,
    coalesce(nullif(trim(meta->>'contact_person'), ''), nullif(trim(meta->>'full_name'), '')),
    coalesce((app->>'must_change_password')::boolean, false)
  );
  return new;
end;
$$;
