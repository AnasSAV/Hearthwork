-- Focus Town: core schema for accounts, houses and the focus economy (Phase 2).
-- Items, inventory, placed items and friendships arrive with Phases 3–4.
--
-- Security model
--   * RLS is enabled on every table. Players (role `authenticated`) can only SELECT their own rows
--     and the catalogs. They never INSERT/UPDATE/DELETE game tables directly.
--   * All writes go through SECURITY DEFINER functions with `search_path = ''`.
--   * Coins only change inside award_focus (and later buy_item / upgrade_house), always together
--     with a coin_ledger row in the same transaction.
--   * The game server uses the service role, but even it can only call functions, not write tables.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  avatar jsonb not null default '{}' check (jsonb_typeof(avatar) = 'object'),
  coins int not null default 0 check (coins >= 0),
  total_focus_min int not null default 0 check (total_focus_min >= 0),
  streak_days int not null default 0 check (streak_days >= 0),
  last_focus_date date,
  created_at timestamptz not null default now()
);
-- Usernames are unique regardless of case.
create unique index profiles_username_lower_key on public.profiles (lower(username));

create table public.house_levels (
  level int primary key check (level >= 1),
  width int not null check (width > 0),
  height int not null check (height > 0),
  rooms int not null check (rooms > 0),
  cost_coins int not null check (cost_coins >= 0),
  min_total_focus_min int not null check (min_total_focus_min >= 0)
);

-- The house ladder lives in the migration (not seed.sql) because the signup trigger needs level 1
-- to exist before the first user signs up.
insert into public.house_levels (level, width, height, rooms, cost_coins, min_total_focus_min) values
  (1, 8, 6, 1, 0, 0),
  (2, 12, 8, 1, 1500, 20 * 60),
  (3, 12, 8, 2, 5000, 80 * 60)
on conflict (level) do update set
  width = excluded.width, height = excluded.height, rooms = excluded.rooms,
  cost_coins = excluded.cost_coins, min_total_focus_min = excluded.min_total_focus_min;

create table public.houses (
  owner_id uuid primary key references public.profiles on delete cascade,
  level int not null default 1 references public.house_levels,
  wallpaper text,
  floor text,
  exterior_style text not null default 'cottage',
  plot_index int unique check (plot_index >= 0),
  visibility text not null default 'friends' check (visibility in ('public', 'friends', 'private'))
);

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_min int check (planned_min in (25, 50)),
  verified_min int not null default 0 check (verified_min >= 0),
  coins_awarded int not null default 0 check (coins_awarded >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned'))
);
-- One active session per user, enforced by the database.
create unique index focus_sessions_one_active on public.focus_sessions (user_id) where status = 'active';
create index focus_sessions_user_started on public.focus_sessions (user_id, started_at desc);

-- Append-only: nobody gets UPDATE/DELETE privileges (see grants below).
create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('focus', 'purchase', 'upgrade', 'bonus')),
  ref_id text,
  created_at timestamptz not null default now()
);
create index coin_ledger_user on public.coin_ledger (user_id, created_at desc);

-- Per-user, per-day (UTC) focus totals. Drives the daily coin cap and, later, the streak calendar.
create table public.focus_daily (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  minutes int not null default 0 check (minutes >= 0),
  coin_minutes int not null default 0 check (coin_minutes >= 0),
  coins int not null default 0 check (coins >= 0),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
-- Supabase grants broad default privileges on `public`. Reset them to read-only, then let RLS
-- decide which rows are visible.

revoke all on public.profiles, public.house_levels, public.houses, public.focus_sessions,
  public.coin_ledger, public.focus_daily from anon, authenticated, service_role;

grant select on public.house_levels to anon, authenticated, service_role;
grant select on public.profiles, public.houses, public.focus_sessions, public.coin_ledger,
  public.focus_daily to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.house_levels enable row level security;
alter table public.houses enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.focus_daily enable row level security;

create policy "house levels are public" on public.house_levels
  for select to anon, authenticated using (true);

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- Phase 4 widens this to houses the player may visit.
create policy "read own house" on public.houses
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "read own focus sessions" on public.focus_sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy "read own ledger" on public.coin_ledger
  for select to authenticated using (user_id = (select auth.uid()));

create policy "read own daily focus" on public.focus_daily
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Signup: profile + level-1 house on the next free plot
-- ---------------------------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plot int;
begin
  -- Placeholder name; the player picks a real one in the profile setup screen.
  insert into public.profiles (id, username)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 9));

  -- Serialize plot assignment so concurrent signups can't grab the same plot.
  perform pg_advisory_xact_lock(hashtext('focus_town.plot_assignment'));
  select coalesce(min(gs.i), 0) into v_plot
  from generate_series(0, (select count(*)::int from public.houses)) as gs(i)
  where not exists (select 1 from public.houses h where h.plot_index = gs.i);

  insert into public.houses (owner_id, level, plot_index) values (new.id, 1, v_plot);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Player-callable: choose username + avatar
-- ---------------------------------------------------------------------------------------------

create function public.update_profile(p_username text, p_avatar jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'username must be 3-16 letters, digits or underscores' using errcode = '22023';
  end if;
  if p_avatar is null or jsonb_typeof(p_avatar) <> 'object'
     or jsonb_typeof(p_avatar -> 'body') <> 'number'
     or (p_avatar ->> 'body')::numeric not in (0, 1, 2, 3, 4, 5) then
    raise exception 'avatar.body must be an integer 0-5' using errcode = '22023';
  end if;

  begin
    update public.profiles
       set username = p_username,
           avatar = jsonb_build_object('body', (p_avatar ->> 'body')::int)
     where id = v_uid
    returning * into v_row;
  exception when unique_violation then
    raise exception 'username is taken' using errcode = '23505';
  end;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Game-server only (service role): focus session lifecycle and rewards
-- ---------------------------------------------------------------------------------------------

-- Starts a session, ending any other active session of the same user first.
create function public.start_focus_session(p_user_id uuid, p_planned_min int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_planned_min is not null and p_planned_min not in (25, 50) then
    raise exception 'planned_min must be 25, 50 or null' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  update public.focus_sessions
     set status = 'abandoned', ended_at = now()
   where user_id = p_user_id and status = 'active';
  insert into public.focus_sessions (user_id, planned_min)
  values (p_user_id, p_planned_min)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.end_focus_session(p_session_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('completed', 'abandoned') then
    raise exception 'status must be completed or abandoned' using errcode = '22023';
  end if;
  update public.focus_sessions
     set status = p_status, ended_at = now()
   where id = p_session_id and status = 'active';
end;
$$;

-- Called once at game-server startup: in-memory session trackers died with the old process.
-- Assumes a single game-server process (Render free tier / one Oracle VM).
create function public.abandon_active_sessions()
returns int
language sql
security definer
set search_path = ''
as $$
  with ended as (
    update public.focus_sessions
       set status = 'abandoned', ended_at = now()
     where status = 'active'
    returning 1
  )
  select count(*)::int from ended;
$$;

-- Credits verified focus minutes (and an optional block-completion bonus) to a player.
-- coins = round(rewardable_minutes × base_rate × (1 + streak_step × min(streak_days, streak_max)))
--         + completion_bonus
-- where rewardable_minutes is capped by the daily cap (UTC day). Minutes beyond the cap still
-- count towards total_focus_min, focus_daily.minutes and the streak.
-- The rule parameters come from shared/src/constants.ts via the game server; defaults mirror them.
create function public.award_focus(
  p_user_id uuid,
  p_session_id uuid,
  p_minutes int,
  p_completion_bonus int default 0,
  p_base_rate numeric default 1,
  p_streak_step numeric default 0.05,
  p_streak_max int default 10,
  p_daily_cap_min int default 480
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_profile public.profiles;
  v_streak int;
  v_coin_minutes_before int;
  v_rewardable int;
  v_focus_coins int;
  v_total int;
begin
  if p_minutes is null or p_minutes < 0 or p_minutes > 60 then
    raise exception 'minutes out of range' using errcode = '22023';
  end if;
  if p_completion_bonus is null or p_completion_bonus < 0 or p_completion_bonus > 100 then
    raise exception 'bonus out of range' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'unknown user' using errcode = '22023';
  end if;

  perform 1 from public.focus_sessions
   where id = p_session_id and user_id = p_user_id and status = 'active'
   for update;
  if not found then
    raise exception 'session is not active for this user' using errcode = '22023';
  end if;

  -- Streak: consecutive UTC days with focus, counting today.
  v_streak := v_profile.streak_days;
  if p_minutes > 0 then
    if v_profile.last_focus_date = v_today then
      v_streak := greatest(v_streak, 1);
    elsif v_profile.last_focus_date = v_today - 1 then
      v_streak := v_streak + 1;
    else
      v_streak := 1;
    end if;
  end if;

  insert into public.focus_daily (user_id, day) values (p_user_id, v_today)
  on conflict (user_id, day) do nothing;
  select coin_minutes into v_coin_minutes_before
    from public.focus_daily where user_id = p_user_id and day = v_today for update;

  v_rewardable := least(p_minutes, greatest(0, p_daily_cap_min - v_coin_minutes_before));
  v_focus_coins := round(
    v_rewardable * p_base_rate * (1 + p_streak_step * least(v_streak, p_streak_max))
  )::int;
  v_total := v_focus_coins + p_completion_bonus;

  update public.profiles
     set coins = coins + v_total,
         total_focus_min = total_focus_min + p_minutes,
         streak_days = v_streak,
         last_focus_date = case when p_minutes > 0 then v_today else last_focus_date end
   where id = p_user_id
  returning * into v_profile;

  if v_focus_coins > 0 then
    insert into public.coin_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, v_focus_coins, 'focus', p_session_id::text);
  end if;
  if p_completion_bonus > 0 then
    insert into public.coin_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, p_completion_bonus, 'bonus', p_session_id::text);
  end if;

  update public.focus_sessions
     set verified_min = verified_min + p_minutes,
         coins_awarded = coins_awarded + v_total
   where id = p_session_id;

  update public.focus_daily
     set minutes = minutes + p_minutes,
         coin_minutes = coin_minutes + v_rewardable,
         coins = coins + v_total
   where user_id = p_user_id and day = v_today;

  return jsonb_build_object(
    'coinsAwarded', v_total,
    'focusCoins', v_focus_coins,
    'bonus', p_completion_bonus,
    'rewardableMinutes', v_rewardable,
    'coins', v_profile.coins,
    'streakDays', v_profile.streak_days,
    'totalFocusMin', v_profile.total_focus_min,
    'todayCoinMinutes', v_coin_minutes_before + v_rewardable
  );
end;
$$;

-- Users whose balance doesn't match their ledger. Should always return zero rows.
create function public.ledger_mismatches()
returns table (user_id uuid, coins int, ledger_sum bigint)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.coins, coalesce(sum(l.delta), 0) as ledger_sum
    from public.profiles p
    left join public.coin_ledger l on l.user_id = p.id
   group by p.id, p.coins
  having p.coins <> coalesce(sum(l.delta), 0);
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges: Postgres grants EXECUTE to PUBLIC by default; Supabase adds anon and
-- authenticated. Revoke everything, then grant precisely.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function public.update_profile(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.start_focus_session(uuid, int) from public, anon, authenticated, service_role;
revoke all on function public.end_focus_session(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.abandon_active_sessions() from public, anon, authenticated, service_role;
revoke all on function public.award_focus(uuid, uuid, int, int, numeric, numeric, int, int)
  from public, anon, authenticated, service_role;
revoke all on function public.ledger_mismatches() from public, anon, authenticated, service_role;

grant execute on function public.update_profile(text, jsonb) to authenticated;
grant execute on function public.start_focus_session(uuid, int) to service_role;
grant execute on function public.end_focus_session(uuid, text) to service_role;
grant execute on function public.abandon_active_sessions() to service_role;
grant execute on function public.award_focus(uuid, uuid, int, int, numeric, numeric, int, int) to service_role;
grant execute on function public.ledger_mismatches() to service_role;
