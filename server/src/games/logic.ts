import type { Client } from 'colyseus';
import type { GameEvent, PlayerState, Vec2 } from '@focus-town/shared';

/** What a game can ask of its room. */
export interface GameContext {
  now(): number;
  /** In [0, 1). */
  random(): number;
  send(client: Client, event: GameEvent): void;
  /** The player did something real in the game; enough of these make a played minute. */
  played(client: Client): void;
  /** Add to the player's score for this visit, optionally replacing their note ("Best 41 s"). */
  score(client: Client, points: number, note?: string): void;
  /** Move a player and tell their client; movement checks restart from there. */
  teleport(client: Client, player: PlayerState, to: Vec2): void;
}

/** One mini-game's rules. All input arrives as "use": the server decides what it means. */
export interface GameLogic {
  join(client: Client, player: PlayerState): void;
  leave(client: Client): void;
  /** The player pressed the action button (E, or a tap on the prompt). */
  use(client: Client, player: PlayerState): void;
  /** Called a few times a second. */
  tick(now: number): void;
  /** Should this player be held in place (e.g. fishing)? */
  locked(sessionId: string): boolean;
  /** A move was accepted. */
  moved?(client: Client, player: PlayerState): void;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const inRect = (r: Rect, p: Vec2): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
