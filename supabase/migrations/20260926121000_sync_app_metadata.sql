-- Supabase Auth writes admin-supplied app_metadata in an UPDATE after the INSERT,
-- so handle_new_user() doesn't see it. Sync role / must_change_password on update too.
create or replace function public.sync_profile_from_app_metadata()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  update profiles set
    role = case when app->>'role' in ('staff', 'client') then app->>'role' else role end,
    must_change_password = coalesce((app->>'must_change_password')::boolean, must_change_password)
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data
        and (new.raw_app_meta_data ? 'role' or new.raw_app_meta_data ? 'must_change_password'))
  execute function public.sync_profile_from_app_metadata();
