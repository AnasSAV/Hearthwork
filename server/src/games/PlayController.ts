import type { Client } from 'colyseus';
import {
  closePlayMinutes,
  createPlayTracker,
  DAILY_REWARD_CAP_MIN,
  PLAY_AWARD_EVERY_MIN,
  recordPlayAction,
  ServerMsg,
  type GameId,
  type GameStatusMessage,
  type PlayTracker,
  type WalletMessage,
} from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { focusRegistry } from '../focus/registry.js';
import { log } from '../log.js';

interface Player {
  client: Client;
  userId: string;
  tracker: PlayTracker;
  /** Played minutes not yet written to the database. */
  unawarded: number;
  playedMin: number;
  coinsEarned: number;
  capReached: boolean;
  score: number;
  note: string | null;
  /** Serializes database calls so awards land in order. */
  queue: Promise<void>;
}

/** The newest game tab of each user is the one that earns. */
const earningSession = new Map<string, string>();

/**
 * Turns game actions into coins: the server watches each minute, and one with enough real
 * actions in it pays half a focus minute through the `award_play` SQL function. Scores are only
 * for show, so nothing a client claims can become coins.
 */
export class PlayController {
  private players = new Map<string, Player>();

  constructor(
    private readonly game: GameId,
    private readonly now: () => number,
  ) {}

  join(client: Client): void {
    const { userId } = client.auth as AuthedUser;
    earningSession.set(userId, client.sessionId);
    this.players.set(client.sessionId, {
      client,
      userId,
      tracker: createPlayTracker(this.now()),
      unawarded: 0,
      playedMin: 0,
      coinsEarned: 0,
      capReached: false,
      score: 0,
      note: null,
      queue: Promise.resolve(),
    });
  }

  /** Pays out what's left; returns once that's saved. */
  async leave(client: Client): Promise<void> {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    this.players.delete(client.sessionId);
    if (earningSession.get(player.userId) === client.sessionId)
      earningSession.delete(player.userId);
    this.flush(player);
    await player.queue;
  }

  played(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (player) player.tracker = recordPlayAction(player.tracker, this.now());
  }

  score(client: Client, points: number, note?: string): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.score += points;
    if (note !== undefined) player.note = note;
    this.sendStatus(player);
  }

  tick(now: number): void {
    for (const player of this.players.values()) {
      const { tracker, played } = closePlayMinutes(player.tracker, now);
      player.tracker = tracker;
      if (played === 0) continue;
      // Focusing in another tab, or playing in a newer one: this minute doesn't pay twice.
      if (
        earningSession.get(player.userId) !== player.client.sessionId ||
        focusRegistry.get(player.userId)
      ) {
        continue;
      }
      player.playedMin += played;
      player.unawarded += played;
      if (player.unawarded >= PLAY_AWARD_EVERY_MIN) this.flush(player);
      this.sendStatus(player);
    }
  }

  sendStatus(player: Player): void {
    const status: GameStatusMessage = {
      score: player.score,
      note: player.note,
      playedMin: player.playedMin,
      coinsEarned: player.coinsEarned,
      capReached: player.capReached,
    };
    player.client.send(ServerMsg.GameStatus, status);
  }

  private flush(player: Player): void {
    const minutes = player.unawarded;
    if (minutes === 0) return;
    player.unawarded = 0;
    player.queue = player.queue.then(async () => {
      try {
        const result = await db().awardPlay(player.userId, this.game, minutes);
        player.coinsEarned += result.coinsAwarded;
        player.capReached = result.rewardableMinutes < minutes;
        const wallet: WalletMessage = {
          coins: result.coins,
          streakDays: result.streakDays,
          totalFocusMin: result.totalFocusMin,
          todayCoinMinutes: result.todayCoinMinutes,
          dailyCapMin: DAILY_REWARD_CAP_MIN,
        };
        player.client.send(ServerMsg.Wallet, wallet);
        this.sendStatus(player);
      } catch (err) {
        // Keep the minutes so the next award retries them.
        if (this.players.has(player.client.sessionId)) player.unawarded += minutes;
        log.error('award_play failed', { userId: player.userId, minutes, error: String(err) });
      }
    });
  }
}
