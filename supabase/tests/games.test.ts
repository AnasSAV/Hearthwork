/**
 * Coins for playing mini-games: half the focus rate, a daily cap, and the ledger invariant.
 * Runs against a local Supabase stack, like the other database tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STREAK_MAX_DAYS, STREAK_STEP } from '../../shared/src/constants.js';
import { PLAY_DAILY_CAP_MIN, PLAY_RATE } from '../../shared/src/games.js';
import { dbConfigured, serviceClient, signUpPlayer, sql } from './helpers.js';

const rules = {
  p_rate: PLAY_RATE,
  p_streak_step: STREAK_STEP,
  p_streak_max: STREAK_MAX_DAYS,
  p_daily_cap_min: PLAY_DAILY_CAP_MIN,
};

describe.skipIf(!dbConfigured)('coins for playing (local Supabase)', () => {
  let service: SupabaseClient;
  let player: SupabaseClient;
  let userId: string;

  async function award(minutes: number) {
    const { data, error } = await service.rpc('award_play', {
      p_user_id: userId,
      p_game: 'fishing',
      p_minutes: minutes,
      ...rules,
    });
    if (error) throw new Error(error.message);
    return data as { coinsAwarded: number; rewardableMinutes: number; coins: number };
  }

  beforeAll(async () => {
    service = serviceClient();
    ({ client: player, userId } = await signUpPlayer());
  });

  afterAll(() => {
    if (userId) sql(`delete from auth.users where id = '${userId}'`);
  });

  it('pays half a coin a minute, keeping the fraction for later', async () => {
    expect((await award(1)).coinsAwarded).toBe(0);
    const second = await award(1);
    expect(second.coinsAwarded).toBe(1);
    expect(second.coins).toBe(1);
    expect((await award(4)).coinsAwarded).toBe(2);
  });

  it('writes a ledger row for every coin change', async () => {
    const { data } = await service
      .from('coin_ledger')
      .select('delta, reason, ref_id')
      .eq('user_id', userId)
      .order('delta');
    expect(data).toEqual([
      { delta: 1, reason: 'play', ref_id: 'fishing' },
      { delta: 2, reason: 'play', ref_id: 'fishing' },
    ]);
    const { data: mismatches } = await service.rpc('ledger_mismatches');
    expect(mismatches).toEqual([]);
  });

  it('pays exactly half of focus at any streak, and leaves the streak alone', async () => {
    const today = new Date().toISOString().slice(0, 10);
    sql(`update public.profiles set streak_days = 10, last_focus_date = '${today}'
         where id = '${userId}'`);
    // Focus at a 10-day streak pays 1.5 coins a minute; play pays 0.75.
    expect((await award(4)).coinsAwarded).toBe(3);
    const { data } = await service
      .from('profiles')
      .select('streak_days, total_focus_min')
      .eq('id', userId)
      .single();
    expect(data).toEqual({ streak_days: 10, total_focus_min: 0 });
  });

  it('ignores an expired streak', async () => {
    sql(`update public.profiles set last_focus_date = '2020-01-01' where id = '${userId}'`);
    expect((await award(2)).coinsAwarded).toBe(1);
  });

  it('stops paying at the daily cap, but keeps counting minutes', async () => {
    const before = sql(
      `select coin_minutes from public.play_daily where user_id = '${userId}' and day = current_date`,
    );
    const left = PLAY_DAILY_CAP_MIN - Number(before);
    sql(`update public.play_daily set coin_minutes = coin_minutes + ${left - 2}
         where user_id = '${userId}' and day = current_date`);
    expect((await award(4)).rewardableMinutes).toBe(2);
    const after = await award(4);
    expect(after.rewardableMinutes).toBe(0);
    expect(after.coinsAwarded).toBe(0);
  });

  it('rejects nonsense and players awarding themselves', async () => {
    await expect(award(-1)).rejects.toThrow();
    await expect(award(61)).rejects.toThrow();
    const self = await player.rpc('award_play', {
      p_user_id: userId,
      p_game: 'fishing',
      p_minutes: 60,
      ...rules,
    });
    expect(self.error).not.toBeNull();
  });
});
