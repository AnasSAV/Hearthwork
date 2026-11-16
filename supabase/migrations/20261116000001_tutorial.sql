-- New players see a short introduction once; this remembers that they have, on any device.

alter table public.profiles add column tutorial_seen_at timestamptz;

create function public.finish_tutorial()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set tutorial_seen_at = coalesce(tutorial_seen_at, now())
   where id = auth.uid();
$$;

revoke all on function public.finish_tutorial() from public, anon, authenticated, service_role;
grant execute on function public.finish_tutorial() to authenticated;
