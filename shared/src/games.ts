import { BASE_RATE, PLAYER_SPEED } from './constants.js';
import type { Vec2 } from './movement.js';

/**
 * The mini-games: each has its own map and room. The rules here are pure so they can be unit
 * tested; the server owns the clock and the randomness and passes them in.
 *
 * Coins come from playing, never from scores: a minute with enough real game actions in it earns
 * half of what a focus minute does, so a score can't be cheated into coins (see PlayTracker).
 */
export const GAME_IDS = ['fishing', 'rafting', 'butterflies', 'treasure'] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface GameInfo {
  id: GameId;
  /** The place, shown on signs and in panels. */
  name: string;
  /** One line for the games panel. */
  tagline: string;
  /** How to play, shown when you arrive. */
  howTo: string;
  /** Map file and cache key (client/public/assets/maps/<map>.json). */
  map: string;
}

export const GAMES: Record<GameId, GameInfo> = {
  fishing: {
    id: 'fishing',
    name: 'Mirror Lake',
    tagline: 'Cast from the pier and reel in something rare.',
    howTo:
      'Stand at the water and cast. When a fish bites, hook it quickly, then stop the marker in the green zone to land it.',
    map: 'lake',
  },
  rafting: {
    id: 'rafting',
    name: 'Rushwater Rapids',
    tagline: 'Race the river, dodge the rocks, grab the buoys.',
    howTo:
      'Launch from the jetty. The river carries you: steer left and right, and hold up to paddle back if you get stuck. Every buoy takes 2 seconds off your time.',
    map: 'rapids',
  },
  butterflies: {
    id: 'butterflies',
    name: 'Butterfly Meadow',
    tagline: 'Chase rare butterflies through the flowers.',
    howTo:
      'Walk up to a butterfly and swing your net. Blue, purple and gold ones are rarer and quicker. Everyone here is after the same butterflies.',
    map: 'meadow',
  },
  treasure: {
    id: 'treasure',
    name: 'Treasure Cove',
    tagline: 'Something is buried in the sand. Warmer, colder...',
    howTo:
      'Dig anywhere on the sand. Each hole tells you how warm you are; after a few digs you get a compass bearing too. Find it in few digs for a bigger score.',
    map: 'cove',
  },
};

// ---------------------------------------------------------------------------------------------
// Coins for playing
// ---------------------------------------------------------------------------------------------

/** Coins per active minute before the streak multiplier: half of focus, at any streak. */
export const PLAY_RATE = BASE_RATE / 2;
/** Active minutes per UTC day that earn coins, across all games. */
export const PLAY_DAILY_CAP_MIN = 120;
/** A minute counts as played with at least this many game actions in it. */
export const PLAY_ACTIONS_PER_MIN = 3;
/** Actions closer together than this count once (holding a button down isn't playing more). */
export const PLAY_ACTION_GAP_MS = 2_000;
/** Played minutes are saved to the database in chunks of this size. */
export const PLAY_AWARD_EVERY_MIN = 2;

export interface PlayTracker {
  /** Start of the minute being watched. */
  minuteStartedAt: number;
  actions: number;
  lastActionAt: number;
}

export function createPlayTracker(now: number): PlayTracker {
  return { minuteStartedAt: now, actions: 0, lastActionAt: -Infinity };
}

/** The player did something real in the game (only the server calls this, after checking it). */
export function recordPlayAction(t: PlayTracker, now: number): PlayTracker {
  if (now - t.lastActionAt < PLAY_ACTION_GAP_MS) return t;
  return { ...t, actions: t.actions + 1, lastActionAt: now };
}

/** Close the minutes that have ended; returns how many of them were really played. */
export function closePlayMinutes(
  t: PlayTracker,
  now: number,
): { tracker: PlayTracker; played: number } {
  let { minuteStartedAt, actions } = t;
  let played = 0;
  while (now - minuteStartedAt >= 60_000) {
    if (actions >= PLAY_ACTIONS_PER_MIN) played += 1;
    actions = 0;
    minuteStartedAt += 60_000;
  }
  return { tracker: { ...t, minuteStartedAt, actions }, played };
}

// ---------------------------------------------------------------------------------------------
// Fishing
// ---------------------------------------------------------------------------------------------

export const FISH = [
  {
    id: 'minnow',
    name: 'Minnow',
    weight: 40,
    points: 1,
    zone: 0.34,
    periodMs: 1500,
    color: '#a8c6d8',
  },
  {
    id: 'perch',
    name: 'Perch',
    weight: 28,
    points: 2,
    zone: 0.28,
    periodMs: 1300,
    color: '#8fb46a',
  },
  {
    id: 'trout',
    name: 'Trout',
    weight: 18,
    points: 3,
    zone: 0.23,
    periodMs: 1150,
    color: '#c98a6a',
  },
  { id: 'carp', name: 'Carp', weight: 9, points: 5, zone: 0.19, periodMs: 1000, color: '#c9a53c' },
  { id: 'koi', name: 'Koi', weight: 4, points: 10, zone: 0.15, periodMs: 880, color: '#ee6d4f' },
  {
    id: 'goldfin',
    name: 'Goldfin',
    weight: 1,
    points: 25,
    zone: 0.11,
    periodMs: 760,
    color: '#ffd24a',
  },
] as const;
export type FishId = (typeof FISH)[number]['id'];

/** A bite comes this long after casting. */
export const FISH_BITE_MIN_MS = 3_000;
export const FISH_BITE_MAX_MS = 11_000;
/** How long you have to hook a bite. Generous enough for a slow connection. */
export const FISH_HOOK_MS = 1_600;
/** How long you have to stop the marker. */
export const FISH_REEL_MS = 7_000;
/**
 * A tap reaches the server after the player saw the marker there, so a stop counts if the marker
 * was in the zone at any moment this recently.
 */
export const FISH_REEL_FORGIVE_MS = 280;

/** Pick a fish; `roll` is in [0, 1). */
export function rollFish(roll: number): (typeof FISH)[number] {
  const total = FISH.reduce((sum, f) => sum + f.weight, 0);
  let left = roll * total;
  for (const f of FISH) {
    left -= f.weight;
    if (left < 0) return f;
  }
  return FISH[0];
}

/** The marker bouncing along the reel bar: 0 at the left, 1 at the right. */
export function reelMarker(elapsedMs: number, periodMs: number): number {
  const phase = ((elapsedMs % periodMs) + periodMs) % periodMs;
  const half = periodMs / 2;
  return phase < half ? phase / half : 2 - phase / half;
}

/** Was the marker inside [zoneStart, zoneStart + zone] during the forgiveness window? */
export function reelHit(
  elapsedMs: number,
  periodMs: number,
  zoneStart: number,
  zone: number,
): boolean {
  for (let back = 0; back <= FISH_REEL_FORGIVE_MS; back += 20) {
    const at = reelMarker(elapsedMs - back, periodMs);
    if (at >= zoneStart && at <= zoneStart + zone) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Rafting
// ---------------------------------------------------------------------------------------------

/** The raft moves faster than walking: the river does most of the work. */
export const RAFT_SPEED = PLAYER_SPEED * 1.35;
/** Sideways steering relative to the current, and paddling back against it with "up". */
export const RAFT_STEER = 0.9;
export const RAFT_PADDLE = -0.5;
/** Passing this close to a buoy collects it. */
export const RAFT_BUOY_RADIUS = 18;
export const RAFT_BUOY_BONUS_SEC = 2;

/**
 * The river carries the raft south unless you paddle against it; steering turns that into a
 * direction. Paddling also means no pocket between a rock and the bank can trap you for good.
 */
export function raftInput(input: Vec2): Vec2 {
  return { x: input.x * RAFT_STEER, y: input.y < 0 ? RAFT_PADDLE : 1 };
}

/** Finish time in seconds after buoy bonuses (never below zero). */
export function raftScore(elapsedMs: number, buoys: number): number {
  return Math.max(0, Math.round((elapsedMs / 1000 - buoys * RAFT_BUOY_BONUS_SEC) * 10) / 10);
}

// ---------------------------------------------------------------------------------------------
// Butterflies
// ---------------------------------------------------------------------------------------------

export const BUTTERFLY_KINDS = [
  { id: 'white', name: 'Cabbage White', weight: 45, points: 1, speed: 16, color: 0xfff6d8 },
  { id: 'orange', name: 'Orange Tip', weight: 30, points: 2, speed: 20, color: 0xffa24c },
  { id: 'blue', name: 'Blue Morpho', weight: 15, points: 4, speed: 28, color: 0x58a8f0 },
  { id: 'purple', name: 'Emperor', weight: 8, points: 8, speed: 36, color: 0xb070e8 },
  { id: 'gold', name: 'Goldwing', weight: 2, points: 20, speed: 46, color: 0xffd83c },
] as const;
export type ButterflyKind = (typeof BUTTERFLY_KINDS)[number]['id'];

export const BUTTERFLY_COUNT = 16;
/** A swing reaches this far from the player's feet (centred a little ahead of them). */
export const NET_RADIUS = 22;
export const NET_REACH = 10;
export const NET_COOLDOWN_MS = 700;
/** A caught butterfly's place is taken by a new one this long afterwards. */
export const BUTTERFLY_RESPAWN_MS = 4_000;

export function rollButterfly(roll: number): (typeof BUTTERFLY_KINDS)[number] {
  const total = BUTTERFLY_KINDS.reduce((sum, k) => sum + k.weight, 0);
  let left = roll * total;
  for (const k of BUTTERFLY_KINDS) {
    left -= k.weight;
    if (left < 0) return k;
  }
  return BUTTERFLY_KINDS[0];
}

// ---------------------------------------------------------------------------------------------
// Treasure
// ---------------------------------------------------------------------------------------------

export const TREASURE_FIND_RADIUS = 16;
export const DIG_COOLDOWN_MS = 800;
/** After this many holes the sand gives you a compass bearing as well. */
export const TREASURE_COMPASS_AFTER = 4;

export const TREASURES = [
  { id: 'bottle', name: 'Message in a bottle', weight: 34, points: 3 },
  { id: 'shell', name: 'Pearly shell', weight: 30, points: 4 },
  { id: 'coin', name: 'Old doubloon', weight: 20, points: 6 },
  { id: 'ring', name: 'Tarnished ring', weight: 11, points: 10 },
  { id: 'chest', name: "Pirate's chest", weight: 5, points: 20 },
] as const;
export type TreasureId = (typeof TREASURES)[number]['id'];

export function rollTreasure(roll: number): (typeof TREASURES)[number] {
  const total = TREASURES.reduce((sum, k) => sum + k.weight, 0);
  let left = roll * total;
  for (const k of TREASURES) {
    left -= k.weight;
    if (left < 0) return k;
  }
  return TREASURES[0];
}

export const HEAT_LEVELS = ['freezing', 'cold', 'warm', 'hot', 'burning'] as const;
export type Heat = (typeof HEAT_LEVELS)[number];

/** How warm a hole is, from its distance to the treasure in pixels. */
export function heatAt(distance: number): Heat {
  if (distance <= 40) return 'burning';
  if (distance <= 80) return 'hot';
  if (distance <= 150) return 'warm';
  if (distance <= 260) return 'cold';
  return 'freezing';
}

export const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type Bearing = (typeof COMPASS)[number];

/** The direction from one point to another, on screen (south is down). */
export function bearingTo(from: Vec2, to: Vec2): Bearing {
  const octant = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4));
  return COMPASS[((octant % 8) + 8) % 8]!;
}

/** Fewer holes, bigger find: +5 for one or two, dropping to nothing by eight. */
export function treasureScore(points: number, digs: number): number {
  return points + Math.max(0, Math.min(5, 8 - digs));
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

/** What's happening in the game, from the server to one player. */
export type GameEvent =
  | { kind: 'cast' }
  | { kind: 'cast-cancelled' }
  | { kind: 'bite' }
  | { kind: 'reel'; periodMs: number; zoneStart: number; zone: number; limitMs: number }
  | { kind: 'caught'; fish: FishId; points: number }
  | { kind: 'escaped'; why: 'too-slow' | 'missed' }
  | { kind: 'raft-start'; buoysLeft: number }
  | { kind: 'raft-buoy'; id: string }
  | { kind: 'raft-finish'; seconds: number; buoys: number; best: boolean }
  | { kind: 'raft-bail' }
  | { kind: 'net'; caught: { kind: ButterflyKind; points: number }[] }
  | { kind: 'dug'; x: number; y: number; heat: Heat; bearing: Bearing | null; digs: number }
  | {
      kind: 'found';
      x: number;
      y: number;
      treasure: TreasureId;
      points: number;
      digs: number;
    }
  | { kind: 'refused'; message: string };

/** The player's standing in this visit (after every change). */
export interface GameStatusMessage {
  score: number;
  /** A game-specific best or count, e.g. "Best 41.2 s". */
  note: string | null;
  playedMin: number;
  coinsEarned: number;
  /** Today's playing cap is used up: games still work but pay nothing more today. */
  capReached: boolean;
}
