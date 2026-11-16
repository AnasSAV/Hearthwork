-- Mini-games: coins for playing, at half the rate of focus.
--
-- Like focus, coins only change here, together with a coin_ledger row. The game server decides
-- which minutes were really played; this function decides what they pay.

alter table public.coin_ledger drop constraint coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('focus', 'purchase', 'upgrade', 'bonus', 'play'));

-- Played minutes per UTC day. `carry` keeps the fraction of a coin between awards, because a
-- minute of play is worth half a coin.
create table public.play_daily (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  minutes int not null default 0,
  coin_minutes int not null default 0,
  coins int not null default 0,
  carry numeric not null default 0,
  primary key (user_id, day)
);

alter table public.play_daily enable row level security;

create policy "players read their own play days" on public.play_daily
  for select to authenticated using (user_id = auth.uid());

-- Credits played minutes to a player.
-- coins = floor(carry + rewardable_minutes × rate × (1 + streak_step × min(streak, streak_max)))
-- where rewardable_minutes is capped per UTC day. Playing never touches the focus streak; it
-- only reads it, so a minute of play is always worth exactly half a minute of focus.
-- The rule parameters come from shared/src/games.ts via the game server.
create function public.award_play(
  p_user_id uuid,
  p_game text,
  p_minutes int,
  p_rate numeric default 0.5,
  p_streak_step numeric default 0.05,
  p_streak_max int default 10,
  p_daily_cap_min int default 120
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
  v_day public.play_daily;
  v_rewardable int;
  v_raw numeric;
  v_coins int;
  v_focus_minutes int;
begin
  if p_minutes is null or p_minutes < 0 or p_minutes > 60 then
    raise exception 'minutes out of range' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'unknown user' using errcode = '22023';
  end if;

  insert into public.play_daily (user_id, day) values (p_user_id, v_today)
  on conflict (user_id, day) do nothing;
  select * into v_day from public.play_daily
   where user_id = p_user_id and day = v_today for update;

  v_streak := public.effective_streak(v_profile.streak_days, v_profile.last_focus_date);
  v_rewardable := least(p_minutes, greatest(0, p_daily_cap_min - v_day.coin_minutes));
  v_raw := v_day.carry
    + v_rewardable * p_rate * (1 + p_streak_step * least(v_streak, p_streak_max));
  v_coins := floor(v_raw)::int;

  update public.profiles set coins = coins + v_coins where id = p_user_id
  returning * into v_profile;

  if v_coins > 0 then
    insert into public.coin_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, v_coins, 'play', p_game);
  end if;

  update public.play_daily
     set minutes = minutes + p_minutes,
         coin_minutes = coin_minutes + v_rewardable,
         coins = coins + v_coins,
         carry = v_raw - v_coins
   where user_id = p_user_id and day = v_today;

  select coalesce(
    (select coin_minutes from public.focus_daily where user_id = p_user_id and day = v_today), 0
  ) into v_focus_minutes;

  return jsonb_build_object(
    'coinsAwarded', v_coins,
    'rewardableMinutes', v_rewardable,
    'coins', v_profile.coins,
    'streakDays', v_profile.streak_days,
    'totalFocusMin', v_profile.total_focus_min,
    'todayCoinMinutes', v_focus_minutes
  );
end;
$$;

revoke all on function public.award_play(uuid, text, int, numeric, numeric, int, int)
  from public, anon, authenticated, service_role;
grant execute on function public.award_play(uuid, text, int, numeric, numeric, int, int)
  to service_role;
