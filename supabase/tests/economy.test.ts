/**
 * Database integration tests: signup trigger, RLS, the focus economy and the ledger invariant.
 * Runs against a local Supabase stack (`supabase start`), so it needs Docker:
 *
 *   npm run test:db
 *
 * Skipped automatically when SUPABASE_URL isn't set.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_RATE,
  COMPLETION_BONUS,
  DAILY_REWARD_CAP_MIN,
  STREAK_MAX_DAYS,
  STREAK_STEP,
} from '../../shared/src/constants.js';
import { anonKey, dbConfigured, serviceKey, sql, url } from './helpers.js';

const rules = {
  p_base_rate: BASE_RATE,
  p_streak_step: STREAK_STEP,
  p_streak_max: STREAK_MAX_DAYS,
  p_daily_cap_min: DAILY_REWARD_CAP_MIN,
};

describe.skipIf(!dbConfigured)('focus economy (local Supabase)', () => {
  let service: SupabaseClient;
  let player: SupabaseClient;
  let userId: string;
  const email = `test-${Date.now()}@focus.town`;

  async function award(sessionId: string, minutes: number, bonus = 0) {
    const { data, error } = await service.rpc('award_focus', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_minutes: minutes,
      p_completion_bonus: bonus,
      ...rules,
    });
    if (error) throw new Error(error.message);
    return data as {
      coinsAwarded: number;
      coins: number;
      streakDays: number;
      rewardableMinutes: number;
    };
  }

  async function startSession(planned: number | null = null): Promise<string> {
    const { data, error } = await service.rpc('start_focus_session', {
      p_user_id: userId,
      p_planned_min: planned,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function coins(): Promise<number> {
    const { data } = await service.from('profiles').select('coins').eq('id', userId).single();
    return (data as { coins: number }).coins;
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    player = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await player.auth.signUp({ email, password: 'correct-horse-42' });
    if (error || !data.user) throw new Error(`signUp failed: ${error?.message}`);
    userId = data.user.id;
  });

  afterAll(() => {
    if (userId) sql(`delete from auth.users where id = '${userId}'`);
  });

  it('signup creates a profile and a level-1 house on a free plot', async () => {
    const { data: profile } = await player.from('profiles').select('*').eq('id', userId).single();
    expect(profile).toMatchObject({ coins: 0, streak_days: 0, avatar: {} });
    const { data: house } = await player.from('houses').select('*').eq('owner_id', userId).single();
    expect(house).toMatchObject({ level: 1, visibility: 'friends' });
    expect(typeof (house as { plot_index: number }).plot_index).toBe('number');
  });

  it('update_profile sets username and avatar, and validates them', async () => {
    const name = `t${Date.now().toString(36).slice(-8)}`;
    const ok = await player.rpc('update_profile', { p_username: name, p_avatar: { body: 3 } });
    expect(ok.error).toBeNull();
    const bad = await player.rpc('update_profile', {
      p_username: 'no spaces!',
      p_avatar: { body: 3 },
    });
    expect(bad.error).not.toBeNull();
    const badAvatar = await player.rpc('update_profile', {
      p_username: name,
      p_avatar: { body: 9 },
    });
    expect(badAvatar.error).not.toBeNull();
  });

  it('RLS: players cannot change coins, write the ledger or award themselves', async () => {
    const upd = await player.from('profiles').update({ coins: 999999 }).eq('id', userId).select();
    expect(upd.error ?? (upd.data?.length === 0 ? 'no rows' : null)).not.toBeNull();
    const ins = await player
      .from('coin_ledger')
      .insert({ user_id: userId, delta: 100, reason: 'bonus' });
    expect(ins.error).not.toBeNull();
    const rpc = await player.rpc('award_focus', {
      p_user_id: userId,
      p_session_id: '00000000-0000-0000-0000-000000000000',
      p_minutes: 5,
    });
    expect(rpc.error).not.toBeNull();
    const start = await player.rpc('start_focus_session', { p_user_id: userId, p_planned_min: 25 });
    expect(start.error).not.toBeNull();
    expect(await coins()).toBe(0);
  });

  it('even the service role can only change coins through functions', async () => {
    const upd = await service.from('profiles').update({ coins: 5 }).eq('id', userId);
    expect(upd.error).not.toBeNull();
    const ins = await service
      .from('coin_ledger')
      .insert({ user_id: userId, delta: 5, reason: 'bonus' });
    expect(ins.error).not.toBeNull();
  });

  it('awards coins with the streak multiplier and a completion bonus', async () => {
    sql(
      `update public.profiles set streak_days = 0, last_focus_date = null where id = '${userId}'`,
    );
    const session = await startSession(25);
    // First focus today → streak 1 → multiplier 1.05; 5 min → round(5.25) = 5
    const first = await award(session, 5);
    expect(first.streakDays).toBe(1);
    expect(first.coinsAwarded).toBe(Math.round(5 * BASE_RATE * (1 + STREAK_STEP)));
    const last = await award(session, 20, COMPLETION_BONUS[25]);
    expect(last.coinsAwarded).toBe(Math.round(20 * 1.05) + COMPLETION_BONUS[25]);
    await service.rpc('end_focus_session', { p_session_id: session, p_status: 'completed' });

    const { data: ledger } = await player
      .from('coin_ledger')
      .select('delta, reason')
      .eq('ref_id', session);
    expect(ledger?.map((r) => r.reason).sort()).toEqual(['bonus', 'focus', 'focus']);
  });

  it('continues a streak from yesterday and resets it after a gap', async () => {
    sql(
      `update public.profiles set streak_days = 4, last_focus_date = (now() at time zone 'utc')::date - 1 where id = '${userId}'`,
    );
    let session = await startSession();
    const cont = await award(session, 10);
    expect(cont.streakDays).toBe(5);
    expect(cont.coinsAwarded).toBe(Math.round(10 * (1 + STREAK_STEP * 5))); // 12.5 → 13

    sql(
      `update public.profiles set streak_days = 30, last_focus_date = (now() at time zone 'utc')::date - 1 where id = '${userId}'`,
    );
    session = await startSession();
    const capped = await award(session, 10);
    expect(capped.coinsAwarded).toBe(Math.round(10 * (1 + STREAK_STEP * STREAK_MAX_DAYS))); // ×1.5

    sql(
      `update public.profiles set streak_days = 7, last_focus_date = (now() at time zone 'utc')::date - 3 where id = '${userId}'`,
    );
    session = await startSession();
    expect((await award(session, 5)).streakDays).toBe(1);
  });

  it('stops paying coins after the daily cap but keeps counting minutes', async () => {
    sql(`delete from public.focus_daily where user_id = '${userId}'`);
    const totalBefore = Number(
      sql(`select total_focus_min from public.profiles where id = '${userId}'`),
    );
    const session = await startSession();
    let last = await award(session, 60);
    for (let i = 1; i < DAILY_REWARD_CAP_MIN / 60; i++) last = await award(session, 60);
    expect(last.rewardableMinutes).toBe(60);
    const over = await award(session, 30);
    expect(over.rewardableMinutes).toBe(0);
    expect(over.coinsAwarded).toBe(0);
    const totalAfter = Number(
      sql(`select total_focus_min from public.profiles where id = '${userId}'`),
    );
    expect(totalAfter - totalBefore).toBe(DAILY_REWARD_CAP_MIN + 30);
  });

  it('allows only one active session per user', async () => {
    const a = await startSession();
    const b = await startSession();
    const { data } = await service.from('focus_sessions').select('id, status').in('id', [a, b]);
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.status]));
    expect(byId[a]).toBe('abandoned');
    expect(byId[b]).toBe('active');
    await expect(award(a, 5)).rejects.toThrow(/not active/);
  });

  it('profiles.coins always equals the ledger sum', async () => {
    const { data, error } = await service.rpc('ledger_mismatches');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const sum = Number(
      sql(`select coalesce(sum(delta),0) from public.coin_ledger where user_id = '${userId}'`),
    );
    expect(await coins()).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });
});
