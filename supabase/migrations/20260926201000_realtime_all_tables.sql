-- Every screen updates live: publish all app tables to Supabase Realtime
-- (reports, tests, test_requests and attachments were added earlier).
-- Realtime respects RLS, so each user only receives changes to rows they may see.
alter publication supabase_realtime add table
  public.clients,
  public.projects,
  public.labs,
  public.project_labs,
  public.profiles;
