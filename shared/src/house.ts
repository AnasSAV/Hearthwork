/**
 * House interiors: room geometry, `canPlace()` and the walkable grid.
 *
 * Each room is a `width × height` tile grid (from `house_levels`). Row 0 is the wall row
 * (only `wall`-layer items), rows 1..height-1 are floor. The front door is below floor tile
 * (doorX, height-1) of room 0; two-room houses connect at row `linkY`. The `save_layout` SQL
 * function enforces the same rules (supabase/migrations/…_houses.sql); keep them in sync.
 */
import { CATALOG_BY_ID, type CatalogItem } from './catalog.js';
import { TILE_SIZE } from './constants.js';
import type { CollisionGrid } from './movement.js';

export interface HouseDims {
  width: number;
  height: number;
  rooms: number;
}

export interface Placement {
  itemId: string;
  room: number;
  x: number;
  y: number;
  rotation: number;
}

export type ItemLookup = (id: string) => CatalogItem | undefined;
export const catalogLookup: ItemLookup = (id) => CATALOG_BY_ID.get(id);

export const doorX = (d: HouseDims) => Math.floor(d.width / 2);
export const linkY = (d: HouseDims) => Math.floor(d.height / 2);

export interface Tile {
  x: number;
  y: number;
}

export function coveredTiles(item: CatalogItem, p: Placement): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = 0; dy < item.size.h; dy++) {
    for (let dx = 0; dx < item.size.w; dx++) tiles.push({ x: p.x + dx, y: p.y + dy });
  }
  return tiles;
}

/** Floor tiles that must stay free so nobody gets boxed in. */
export function doorwayTiles(d: HouseDims, room: number): Tile[] {
  const tiles: Tile[] = [];
  if (room === 0) tiles.push({ x: doorX(d), y: d.height - 1 });
  if (d.rooms > 1 && room === 0) tiles.push({ x: d.width - 1, y: linkY(d) });
  if (d.rooms > 1 && room === 1) tiles.push({ x: 0, y: linkY(d) });
  return tiles;
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): PlaceCheck => ({ ok: false, reason });
const tileKey = (room: number, t: Tile) => `${room}:${t.x}:${t.y}`;

/**
 * Can `candidate` go into a house that already has `existing` placed? Ownership counts are
 * checked separately (the editor tracks what's left in the inventory; SQL re-checks on save).
 */
export function canPlace(
  dims: HouseDims,
  existing: readonly Placement[],
  candidate: Placement,
  lookup: ItemLookup = catalogLookup,
): PlaceCheck {
  const item = lookup(candidate.itemId);
  if (!item) return fail('Unknown item');
  if (item.category === 'wall' || item.category === 'floor') {
    return fail('Wallpapers and floors restyle the room');
  }
  if (candidate.rotation !== 0) return fail('Rotation is not supported yet');
  if (candidate.room < 0 || candidate.room >= dims.rooms) return fail('No such room');

  const { x, y } = candidate;
  const { w, h } = item.size;
  if (x < 0 || x + w > dims.width) return fail('Outside the room');
  if (item.layer === 'wall') {
    if (y !== 0 || h !== 1) return fail('Wall items go on the top wall');
  } else if (y < 1 || y + h > dims.height) {
    return fail(y < 1 ? 'Only wall items go on the wall' : 'Outside the room');
  }

  const tiles = coveredTiles(item, candidate);
  const sameLayer = new Set<string>();
  const hostTiles = new Set<string>();
  for (const p of existing) {
    const other = lookup(p.itemId);
    if (!other || p.room !== candidate.room) continue;
    for (const t of coveredTiles(other, p)) {
      if (other.layer === item.layer) sameLayer.add(tileKey(p.room, t));
      if (other.layer === 'floor' && other.surfaceHost) hostTiles.add(tileKey(p.room, t));
    }
  }
  if (tiles.some((t) => sameLayer.has(tileKey(candidate.room, t)))) {
    return fail('Something is already there');
  }
  if (item.layer === 'surface' && !tiles.every((t) => hostTiles.has(tileKey(candidate.room, t)))) {
    return fail('Needs a table or desk underneath');
  }
  if (item.layer === 'floor') {
    const doors = doorwayTiles(dims, candidate.room);
    if (tiles.some((t) => doors.some((d) => d.x === t.x && d.y === t.y))) {
      return fail('Keep the doorway clear');
    }
  }
  return { ok: true };
}

/** Validate a whole layout the way `save_layout` does (minus ownership). First problem wins. */
export function validateLayout(
  dims: HouseDims,
  placements: readonly Placement[],
  lookup: ItemLookup = catalogLookup,
): PlaceCheck {
  // Place non-surface items first so surface items find their hosts regardless of order.
  const order = [...placements].sort(
    (a, b) =>
      Number(lookup(a.itemId)?.layer === 'surface') - Number(lookup(b.itemId)?.layer === 'surface'),
  );
  const placed: Placement[] = [];
  for (const p of order) {
    const check = canPlace(dims, placed, p, lookup);
    if (!check.ok) return { ok: false, reason: `${p.itemId}: ${check.reason}` };
    placed.push(p);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// The interior as a walkable world (shared by the client renderer and server movement checks)
// ---------------------------------------------------------------------------------------------

/**
 * World layout in tiles: a 1-tile outer wall all around, rooms side by side separated by a
 * 1-tile wall with a doorway at `linkY`, and the exit in the bottom wall below the front door.
 */
export const houseWorld = {
  width: (d: HouseDims) => d.rooms * d.width + (d.rooms - 1) + 2,
  height: (d: HouseDims) => d.height + 2,
  roomOrigin: (d: HouseDims, room: number): Tile => ({ x: 1 + room * (d.width + 1), y: 1 }),
  exitTile: (d: HouseDims): Tile => ({ x: 1 + doorX(d), y: d.height + 1 }),
  /** Feet position for someone arriving through the front door. */
  spawn: (d: HouseDims) => ({
    x: (1 + doorX(d)) * TILE_SIZE + TILE_SIZE / 2,
    y: d.height * TILE_SIZE + TILE_SIZE - 2,
  }),
};

export function houseCollisionGrid(
  dims: HouseDims,
  placements: readonly Placement[],
  lookup: ItemLookup = catalogLookup,
): CollisionGrid {
  const width = houseWorld.width(dims);
  const height = houseWorld.height(dims);
  const solid = new Uint8Array(width * height).fill(1);
  const set = (x: number, y: number, v: 0 | 1) => {
    if (x >= 0 && y >= 0 && x < width && y < height) solid[y * width + x] = v;
  };
  for (let r = 0; r < dims.rooms; r++) {
    const o = houseWorld.roomOrigin(dims, r);
    // Floor rows are open; row 0 (the wall) stays solid.
    for (let y = 1; y < dims.height; y++)
      for (let x = 0; x < dims.width; x++) set(o.x + x, o.y + y, 0);
    if (r > 0) set(o.x - 1, o.y + linkY(dims), 0);
  }
  const exit = houseWorld.exitTile(dims);
  set(exit.x, exit.y, 0);
  for (const p of placements) {
    const item = lookup(p.itemId);
    if (!item || item.layer !== 'floor') continue;
    const o = houseWorld.roomOrigin(dims, p.room);
    for (const t of coveredTiles(item, p)) set(o.x + t.x, o.y + t.y, 1);
  }
  return { width, height, tileSize: TILE_SIZE, solid };
}

export interface StudySeat {
  /** `<placed item id>:<column>` */
  id: string;
  /** World tile the player stands on. */
  tile: Tile;
}

/** Seats in front of (below) desks and tables, where a visitor can focus. */
export function studySeats(
  dims: HouseDims,
  placements: readonly (Placement & { id: string })[],
  lookup: ItemLookup = catalogLookup,
): StudySeat[] {
  const grid = houseCollisionGrid(dims, placements, lookup);
  const seats: StudySeat[] = [];
  for (const p of placements) {
    const item = lookup(p.itemId);
    if (!item?.studySpot) continue;
    const o = houseWorld.roomOrigin(dims, p.room);
    const y = p.y + item.size.h;
    if (y >= dims.height) continue;
    for (let dx = 0; dx < item.size.w; dx++) {
      const tile = { x: o.x + p.x + dx, y: o.y + y };
      if (grid.solid[tile.y * grid.width + tile.x] === 0) seats.push({ id: `${p.id}:${dx}`, tile });
    }
  }
  return seats;
}
