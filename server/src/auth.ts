import { ErrorCode, ServerError, type AuthContext } from 'colyseus';
import { DAILY_REWARD_CAP_MIN, encodeAvatar, type WalletMessage } from '@focus-town/shared';
import { db } from './db.js';
import { log } from './log.js';

/** What `client.auth` holds after a successful join. */
export interface AuthedUser {
  userId: string;
  username: string;
  /** encodeAvatar() form, as synced in PlayerState. */
  avatar: string;
  wallet: WalletMessage;
}

/**
 * Verify the Supabase access token the client sent (SDK `client.auth.token`, arriving as a
 * bearer token) and load the player's profile with the service role.
 */
export async function authenticate(context: AuthContext): Promise<AuthedUser> {
  if (!context.token) throw new ServerError(ErrorCode.AUTH_FAILED, 'Please sign in.');

  const userId = await db().verifyAccessToken(context.token);
  if (!userId) {
    log.warn('join rejected: invalid token', { ip: context.ip });
    throw new ServerError(ErrorCode.AUTH_FAILED, 'Your session expired. Please sign in again.');
  }

  const profile = await db().getProfile(userId);
  if (!profile) throw new ServerError(ErrorCode.AUTH_FAILED, 'No profile found for this account.');
  if (!profile.avatar) {
    throw new ServerError(ErrorCode.AUTH_FAILED, 'Finish setting up your profile first.');
  }

  return {
    userId,
    username: profile.username,
    avatar: encodeAvatar(profile.avatar),
    wallet: {
      coins: profile.coins,
      streakDays: profile.streakDays,
      totalFocusMin: profile.totalFocusMin,
      todayCoinMinutes: await db().getTodayCoinMinutes(userId),
      dailyCapMin: DAILY_REWARD_CAP_MIN,
    },
  };
}
