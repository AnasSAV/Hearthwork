/**
 * Database access for the game server. Uses the Supabase service-role (secret) key, which must
 * only ever exist in server/.env. The server never writes game tables directly: every change
 * goes through a SECURITY DEFINER SQL function (see supabase/migrations).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  BASE_RATE,
  DAILY_REWARD_CAP_MIN,
  STREAK_MAX_DAYS,
  STREAK_STEP,
  type FocusBlock,
} from '@focus-town/shared';
import { config } from './config.js';

export interface Profile {
  id: string;
  username: string;
  avatar: { body?: number };
  coins: number;
  totalFocusMin: number;
  streakDays: number;
  /** True once the player has picked a username and avatar. */
  ready: boolean;
}

export interface AwardResult {
  coinsAwarded: number;
  focusCoins: number;
  bonus: number;
  rewardableMinutes: number;
  coins: number;
  streakDays: number;
  totalFocusMin: number;
  todayCoinMinutes: number;
}

/** Everything the game server needs from Postgres. Implemented by Supabase and by test fakes. */
export interface GameDb {
  /** Verify a Supabase access token; returns the user id or null. */
  verifyAccessToken(token: string): Promise<string | null>;
  getProfile(userId: string): Promise<Profile | null>;
  getTodayCoinMinutes(userId: string): Promise<number>;
  startFocusSession(userId: string, plannedMin: FocusBlock | null): Promise<string>;
  endFocusSession(sessionId: string, status: 'completed' | 'abandoned'): Promise<void>;
  awardFocus(
    userId: string,
    sessionId: string,
    minutes: number,
    completionBonus: number,
  ): Promise<AwardResult>;
  abandonActiveSessions(): Promise<number>;
}

interface ProfileRow {
  id: string;
  username: string;
  avatar: { body?: number } | null;
  coins: number;
  total_focus_min: number;
  streak_days: number;
}

export class SupabaseGameDb implements GameDb {
  constructor(private readonly sb: SupabaseClient) {}

  async verifyAccessToken(token: string): Promise<string | null> {
    // Verifies locally against the project's JWKS when asymmetric signing keys are enabled,
    // otherwise asks the Auth server. Either way the signature and expiry are checked.
    const { data, error } = await this.sb.auth.getClaims(token);
    if (error || !data?.claims.sub || data.claims.role !== 'authenticated') return null;
    return data.claims.sub;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('id, username, avatar, coins, total_focus_min, streak_days')
      .eq('id', userId)
      .maybeSingle<ProfileRow>();
    if (error) throw new Error(`getProfile: ${error.message}`);
    if (!data) return null;
    const avatar = data.avatar ?? {};
    return {
      id: data.id,
      username: data.username,
      avatar,
      coins: data.coins,
      totalFocusMin: data.total_focus_min,
      streakDays: data.streak_days,
      ready: typeof avatar.body === 'number',
    };
  }

  async getTodayCoinMinutes(userId: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10); // UTC day, same as award_focus
    const { data, error } = await this.sb
      .from('focus_daily')
      .select('coin_minutes')
      .eq('user_id', userId)
      .eq('day', today)
      .maybeSingle<{ coin_minutes: number }>();
    if (error) throw new Error(`getTodayCoinMinutes: ${error.message}`);
    return data?.coin_minutes ?? 0;
  }

  async startFocusSession(userId: string, plannedMin: FocusBlock | null): Promise<string> {
    const { data, error } = await this.sb.rpc('start_focus_session', {
      p_user_id: userId,
      p_planned_min: plannedMin,
    });
    if (error) throw new Error(`start_focus_session: ${error.message}`);
    return data as string;
  }

  async endFocusSession(sessionId: string, status: 'completed' | 'abandoned'): Promise<void> {
    const { error } = await this.sb.rpc('end_focus_session', {
      p_session_id: sessionId,
      p_status: status,
    });
    if (error) throw new Error(`end_focus_session: ${error.message}`);
  }

  async awardFocus(
    userId: string,
    sessionId: string,
    minutes: number,
    completionBonus: number,
  ): Promise<AwardResult> {
    const { data, error } = await this.sb.rpc('award_focus', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_minutes: minutes,
      p_completion_bonus: completionBonus,
      p_base_rate: BASE_RATE,
      p_streak_step: STREAK_STEP,
      p_streak_max: STREAK_MAX_DAYS,
      p_daily_cap_min: DAILY_REWARD_CAP_MIN,
    });
    if (error) throw new Error(`award_focus: ${error.message}`);
    return data as AwardResult;
  }

  async abandonActiveSessions(): Promise<number> {
    const { data, error } = await this.sb.rpc('abandon_active_sessions');
    if (error) throw new Error(`abandon_active_sessions: ${error.message}`);
    return data as number;
  }
}

let instance: GameDb | null = null;

export function db(): GameDb {
  if (!instance) {
    instance = new SupabaseGameDb(
      createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
  }
  return instance;
}

/** Tests swap in a fake. */
export function setDb(fake: GameDb): void {
  instance = fake;
}
