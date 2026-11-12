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
  parseAvatar,
  type Avatar,
  PLAY_DAILY_CAP_MIN,
  PLAY_RATE,
  type FocusBlock,
  type GameId,
} from '@focus-town/shared';
import { config } from './config.js';

export interface Profile {
  id: string;
  username: string;
  /** Null until the player has made a (v2) character. */
  avatar: Avatar | null;
  coins: number;
  totalFocusMin: number;
  streakDays: number;
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

export interface PlayAwardResult {
  coinsAwarded: number;
  rewardableMinutes: number;
  coins: number;
  streakDays: number;
  totalFocusMin: number;
  todayCoinMinutes: number;
}

export interface HouseRecord {
  ownerId: string;
  ownerName: string;
  level: number;
  width: number;
  height: number;
  rooms: number;
  wallpaper: string | null;
  floor: string | null;
  visibility: 'public' | 'friends' | 'private';
  exteriorStyle: string;
  /** Who lives here: the owner (unless they moved in elsewhere) and their housemates. */
  memberIds: string[];
  items: { id: string; itemId: string; room: number; x: number; y: number; placedBy: string }[];
}

export interface ChatReport {
  reporterId: string;
  reportedId: string;
  room: string;
  messageId: string;
  message: string;
  reason: string | null;
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
  awardPlay(userId: string, game: GameId, minutes: number): Promise<PlayAwardResult>;
  getHouse(ownerId: string): Promise<HouseRecord | null>;
  canVisit(visitorId: string, ownerId: string): Promise<boolean>;
  /** Store a reported chat message for moderation. Returns false if already reported by them. */
  reportChat(report: ChatReport): Promise<boolean>;
}

interface ProfileRow {
  id: string;
  username: string;
  avatar: unknown;
  coins: number;
  total_focus_min: number;
  streak_days: number;
  last_focus_date: string | null;
}

/** A streak only counts if the last focus day was today or yesterday (UTC). */
function effectiveStreak(streak: number, lastFocusDate: string | null): number {
  if (!lastFocusDate) return 0;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return lastFocusDate >= yesterday ? streak : 0;
}

export class SupabaseGameDb implements GameDb {
  private readonly houses: SupabaseHouseQueries;

  constructor(private readonly sb: SupabaseClient) {
    this.houses = new SupabaseHouseQueries(sb);
  }

  getHouse(ownerId: string): Promise<HouseRecord | null> {
    return this.houses.getHouse(ownerId);
  }

  canVisit(visitorId: string, ownerId: string): Promise<boolean> {
    return this.houses.canVisit(visitorId, ownerId);
  }

  async reportChat(r: ChatReport): Promise<boolean> {
    const { error } = await this.sb.from('chat_reports').insert({
      reporter_id: r.reporterId,
      reported_id: r.reportedId,
      room: r.room,
      message_id: r.messageId,
      message: r.message,
      reason: r.reason,
    });
    if (error?.code === '23505') return false; // unique (reporter, message): already reported
    if (error) throw new Error(`reportChat: ${error.message}`);
    return true;
  }

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
      .select('id, username, avatar, coins, total_focus_min, streak_days, last_focus_date')
      .eq('id', userId)
      .maybeSingle<ProfileRow>();
    if (error) throw new Error(`getProfile: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      username: data.username,
      avatar: parseAvatar(data.avatar),
      coins: data.coins,
      totalFocusMin: data.total_focus_min,
      streakDays: effectiveStreak(data.streak_days, data.last_focus_date),
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

  async awardPlay(userId: string, game: GameId, minutes: number): Promise<PlayAwardResult> {
    const { data, error } = await this.sb.rpc('award_play', {
      p_user_id: userId,
      p_game: game,
      p_minutes: minutes,
      p_rate: PLAY_RATE,
      p_streak_step: STREAK_STEP,
      p_streak_max: STREAK_MAX_DAYS,
      p_daily_cap_min: PLAY_DAILY_CAP_MIN,
    });
    if (error) throw new Error(`award_play: ${error.message}`);
    return data as PlayAwardResult;
  }

  async abandonActiveSessions(): Promise<number> {
    const { data, error } = await this.sb.rpc('abandon_active_sessions');
    if (error) throw new Error(`abandon_active_sessions: ${error.message}`);
    return data as number;
  }
}

interface HouseRow {
  owner_id: string;
  level: number;
  wallpaper: string | null;
  floor: string | null;
  visibility: HouseRecord['visibility'];
  exterior_style: string;
  profiles: { username: string } | null;
  house_levels: { width: number; height: number; rooms: number } | null;
}

export class SupabaseHouseQueries {
  constructor(private readonly sb: SupabaseClient) {}

  async getHouse(ownerId: string): Promise<HouseRecord | null> {
    const { data, error } = await this.sb
      .from('houses')
      .select(
        'owner_id, level, wallpaper, floor, visibility, exterior_style, ' +
          // profiles also points back at houses (home_owner), so name the owner relation.
          'profiles!houses_owner_id_fkey(username), house_levels(width, height, rooms)',
      )
      .eq('owner_id', ownerId)
      .maybeSingle<HouseRow>();
    if (error) throw new Error(`getHouse: ${error.message}`);
    if (!data || !data.house_levels) return null;
    const items = await this.sb
      .from('placed_items')
      .select('id, item_id, room, x, y, placed_by')
      .eq('owner_id', ownerId)
      .order('id');
    if (items.error) throw new Error(`getHouse items: ${items.error.message}`);
    const members = await this.sb
      .from('profiles')
      .select('id, home_owner')
      .or(`id.eq.${ownerId},home_owner.eq.${ownerId}`)
      .returns<{ id: string; home_owner: string | null }[]>();
    if (members.error) throw new Error(`getHouse members: ${members.error.message}`);
    return {
      ownerId: data.owner_id,
      ownerName: data.profiles?.username ?? 'someone',
      level: data.level,
      width: data.house_levels.width,
      height: data.house_levels.height,
      rooms: data.house_levels.rooms,
      wallpaper: data.wallpaper,
      floor: data.floor,
      visibility: data.visibility,
      exteriorStyle: data.exterior_style,
      memberIds: members.data.filter((m) => (m.home_owner ?? m.id) === ownerId).map((m) => m.id),
      items: (
        items.data as {
          id: string;
          item_id: string;
          room: number;
          x: number;
          y: number;
          placed_by: string;
        }[]
      ).map((r) => ({
        id: r.id,
        itemId: r.item_id,
        room: r.room,
        x: r.x,
        y: r.y,
        placedBy: r.placed_by,
      })),
    };
  }

  async canVisit(visitorId: string, ownerId: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc('can_visit', {
      p_visitor: visitorId,
      p_owner: ownerId,
    });
    if (error) throw new Error(`can_visit: ${error.message}`);
    return data === true;
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
