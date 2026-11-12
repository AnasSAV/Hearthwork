import type { Client } from 'colyseus';
import {
  MOVE_MIN_INTERVAL_MS,
  ServerMsg,
  PLAYER_SPEED,
  validateMove,
  type CollisionGrid,
  type MoveCorrectMessage,
  type MoveMessage,
  type PlayerState,
} from '@focus-town/shared';
import { log } from '../log.js';

interface MoveTrack {
  /** Server clock (ms) when the last move was accepted. */
  at: number;
  /** Server clock (ms) when the last move message arrived, accepted or not. */
  receivedAt: number;
}

/**
 * Server-side check of client-predicted movement: rate limit, speed and collision against the
 * room's grid. Rejected moves get a `move:correct` so the client snaps back.
 */
export class MovementGuard {
  private tracks = new Map<string, MoveTrack>();

  constructor(
    private readonly grid: () => CollisionGrid,
    private readonly now: () => number,
    private readonly speed: () => number = () => PLAYER_SPEED,
  ) {}

  join(sessionId: string): void {
    this.tracks.set(sessionId, { at: this.now(), receivedAt: 0 });
  }

  leave(sessionId: string): void {
    this.tracks.delete(sessionId);
  }

  /** Forget elapsed time (after reconnects/teleports) so it can't be banked for a long jump. */
  reset(sessionId: string): void {
    const track = this.tracks.get(sessionId);
    if (track) track.at = this.now();
  }

  /**
   * Apply a move if it's legal. `locked` players (seated at a desk) are held in place.
   */
  handle(client: Client, player: PlayerState, msg: MoveMessage, locked: boolean): void {
    const track = this.tracks.get(client.sessionId);
    if (!track) return;
    const now = this.now();
    // Rate limit: the client sends ≤10/s; anything faster is dropped (positions are absolute,
    // so the next message carries the information anyway).
    if (now - track.receivedAt < MOVE_MIN_INTERVAL_MS) return;
    track.receivedAt = now;

    if (locked) {
      if (msg.x !== player.x || msg.y !== player.y) correct(client, player);
      return;
    }

    const from = { x: player.x, y: player.y };
    const check = validateMove(this.grid(), from, msg, now - track.at, this.speed());
    if (!check.ok) {
      log.warn('move rejected', {
        sessionId: client.sessionId,
        reason: check.reason,
        from,
        to: { x: msg.x, y: msg.y },
      });
      correct(client, player);
      return;
    }
    player.x = msg.x;
    player.y = msg.y;
    player.dir = msg.dir;
    player.moving = msg.moving;
    track.at = now;
  }
}

export function correct(client: Client, player: PlayerState): void {
  const correction: MoveCorrectMessage = { x: player.x, y: player.y };
  client.send(ServerMsg.MoveCorrect, correction);
}
