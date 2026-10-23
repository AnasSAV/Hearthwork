-- Focus Town: chat reports and player stats (Phase 5).

-- Reported chat messages, written by the game server (which holds the authoritative copy of
-- every message it relayed). Players can't read or write this table; review it in the
-- dashboard / SQL editor.
create table public.chat_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles on delete cascade,
  reported_id uuid references public.profiles on delete set null,
  room text not null,
  message_id text not null,
  message text not null,
  reason text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  unique (reporter_id, message_id)
);
create index chat_reports_open on public.chat_reports (created_at desc) where not resolved;

revoke all on public.chat_reports from anon, authenticated, service_role;
grant select, insert on public.chat_reports to service_role;
alter table public.chat_reports enable row level security;

-- Effective streak: the stored streak only counts if the player focused today or yesterday (UTC).
create function public.effective_streak(p_streak int, p_last date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_last >= (now() at time zone 'utc')::date - 1 then p_streak else 0 end;
$$;

-- Everything the stats panel shows, in one round trip.
create function public.my_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select * from public.profiles where id = auth.uid()),
  days as (
    select day, minutes from public.focus_daily where user_id = auth.uid() and minutes > 0
  ),
  -- Longest run of consecutive days: group days by (day - row_number) islands.
  islands as (
    select day - (row_number() over (order by day))::int as grp from days
  ),
  sessions as (
    select count(*) filter (where status = 'completed') as completed, count(*) as total
      from public.focus_sessions where user_id = auth.uid()
  ),
  ledger as (
    select coalesce(sum(delta) filter (where delta > 0), 0) as earned,
           coalesce(-sum(delta) filter (where delta < 0), 0) as spent
      from public.coin_ledger where user_id = auth.uid()
  )
  select jsonb_build_object(
    'coins', me.coins,
    'totalFocusMin', me.total_focus_min,
    'streakDays', public.effective_streak(me.streak_days, me.last_focus_date),
    'longestStreak', coalesce((select max(n) from (select count(*) as n from islands group by grp) s), 0),
    'bestDayMin', coalesce((select max(minutes) from days), 0),
    'daysFocused', (select count(*) from days),
    'sessionsCompleted', sessions.completed,
    'sessionsTotal', sessions.total,
    'coinsEarned', ledger.earned,
    'coinsSpent', ledger.spent,
    'memberSince', me.created_at
  )
  from me, sessions, ledger;
$$;

revoke all on function public.effective_streak(int, date) from public, anon, authenticated, service_role;
revoke all on function public.my_stats() from public, anon, authenticated, service_role;
grant execute on function public.effective_streak(int, date) to authenticated, service_role;
grant execute on function public.my_stats() to authenticated;
