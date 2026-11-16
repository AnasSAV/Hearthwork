import {
  MOVE_MAX_CREDIT_MS,
  MOVE_SLACK_PX,
  MOVE_SPEED_TOLERANCE,
  PLAYER_FEET,
  PLAYER_SPEED,
  TILE_SIZE,
} from './constants.js';
import type { Direction } from './schemas.js';
import { findTileLayer, MapLayer, type TiledMap } from './tiled.js';

/** Solid/walkable grid built from a map's collision layer (any non-empty tile is solid). */
export interface CollisionGrid {
  width: number;
  height: number;
  tileSize: number;
  solid: Uint8Array;
}

export function collisionGridFromTiled(
  map: TiledMap,
  layerName: string = MapLayer.Collision,
): CollisionGrid {
  const layer = findTileLayer(map, layerName);
  if (!layer) throw new Error(`Map has no "${layerName}" tile layer`);
  const solid = new Uint8Array(layer.width * layer.height);
  layer.data.forEach((gid, i) => {
    solid[i] = gid !== 0 ? 1 : 0;
  });
  return { width: layer.width, height: layer.height, tileSize: map.tilewidth, solid };
}

export function isSolidTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}

/** True if a player standing with their feet at (x, y) overlaps nothing solid. */
export function canStand(grid: CollisionGrid, x: number, y: number): boolean {
  const ts = grid.tileSize;
  // Shrink the right/bottom edge by a hair so a box flush against a tile edge isn't "inside" it.
  const left = Math.floor((x - PLAYER_FEET.w / 2) / ts);
  const right = Math.floor((x + PLAYER_FEET.w / 2 - 0.001) / ts);
  const top = Math.floor((y - PLAYER_FEET.h) / ts);
  const bottom = Math.floor((y - 0.001) / ts);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (isSolidTile(grid, tx, ty)) return false;
    }
  }
  return true;
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Advance a player by one frame of input. Each axis is resolved separately so players
 * slide along walls. Used by the client for prediction; the server re-checks the result.
 */
export function stepMovement(
  grid: CollisionGrid,
  pos: Vec2,
  input: Vec2,
  dtMs: number,
  speed: number = PLAYER_SPEED,
): Vec2 {
  const len = Math.hypot(input.x, input.y);
  if (len === 0) return { ...pos };
  const dist = (speed * dtMs) / 1000;
  const dx = (input.x / len) * dist;
  const dy = (input.y / len) * dist;
  let { x, y } = pos;
  if (dx !== 0 && canStand(grid, x + dx, y)) x += dx;
  if (dy !== 0 && canStand(grid, x, y + dy)) y += dy;
  return { x, y };
}

/** Direction a player faces for a given input vector (horizontal wins on diagonals). */
export function facingFor(input: Vec2, current: Direction): Direction {
  if (input.x < 0) return 'left';
  if (input.x > 0) return 'right';
  if (input.y < 0) return 'up';
  if (input.y > 0) return 'down';
  return current;
}

/** True if every sampled point on the straight segment a→b is standable. */
function segmentClear(grid: CollisionGrid, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!canStand(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

export type MoveCheck = { ok: true } | { ok: false; reason: 'too_fast' | 'blocked' };

/**
 * Server-side validation of a client-predicted move from `from` to `to`, `elapsedMs`
 * after the previous accepted move. Allows the straight path or either axis-first path,
 * matching how stepMovement slides along walls.
 */
export function validateMove(
  grid: CollisionGrid,
  from: Vec2,
  to: Vec2,
  elapsedMs: number,
  speed: number = PLAYER_SPEED,
): MoveCheck {
  const credit = Math.min(Math.max(elapsedMs, 0), MOVE_MAX_CREDIT_MS);
  const allowed = (speed * MOVE_SPEED_TOLERANCE * credit) / 1000 + MOVE_SLACK_PX;
  if (Math.hypot(to.x - from.x, to.y - from.y) > allowed) return { ok: false, reason: 'too_fast' };
  if (!canStand(grid, to.x, to.y)) return { ok: false, reason: 'blocked' };
  if (segmentClear(grid, from, to)) return { ok: true };
  const xFirst = { x: to.x, y: from.y };
  if (segmentClear(grid, from, xFirst) && segmentClear(grid, xFirst, to)) return { ok: true };
  const yFirst = { x: from.x, y: to.y };
  if (segmentClear(grid, from, yFirst) && segmentClear(grid, yFirst, to)) return { ok: true };
  return { ok: false, reason: 'blocked' };
}

/** One step in the direction a player faces. */
export function facingVector(dir: string): Vec2 {
  if (dir === 'left') return { x: -1, y: 0 };
  if (dir === 'right') return { x: 1, y: 0 };
  if (dir === 'up') return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/** Feet position at the centre-bottom of a tile. */
export function tileToFeet(tx: number, ty: number, tileSize = TILE_SIZE): Vec2 {
  return { x: tx * tileSize + tileSize / 2, y: ty * tileSize + tileSize - 1 };
}
