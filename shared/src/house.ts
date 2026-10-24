/**
 * Homes: the yard (garden + house exterior) and the interior, `canPlace()` and the walkable grid.
 *
 * Interior rooms are `width × height` tile grids (from `house_levels`). Row 0 is the wall row
 * (only `wall`-layer items), rows 1..height-1 are floor. The front door is below floor tile
 * (doorX, height-1) of room 0; two-room houses connect at row `linkY`.
 *
 * The yard is room YARD_ROOM (-1): a fixed YARD.width × YARD.height garden with the house
 * exterior at the top, a path from the front door down and across to a gate in the left fence
 * (the way to town), and a signpost above the gate. Only garden items go in the yard and only
 * other items go inside. The `save_layout` SQL function enforces the same rules
 * (supabase/migrations/…_houses.sql, …_homes.sql); keep them in sync.
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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------------------------
// The yard
// ---------------------------------------------------------------------------------------------

export const YARD_ROOM = -1;
export const YARD = { width: 20, height: 14 } as const;
/** House exterior in yard tiles: left edge, bottom edge (exclusive), largest size, door column. */
export const YARD_HOUSE = { x: 5, bottom: 6, maxWidth: 10, height: 6, doorCol: 2 } as const;
/** Width in tiles of the house exterior at a level (small/medium/big cabin). */
export const houseExteriorWidth = (level: number) => (level >= 3 ? 10 : level === 2 ? 8 : 6);
/** Yard tile in front of the door: stand here to go inside. */
export const YARD_DOORSTEP: Tile = { x: YARD_HOUSE.x + YARD_HOUSE.doorCol, y: YARD_HOUSE.bottom };
/** Yard rows with a gap in the left fence: walking out there goes to town. */
export const YARD_GATE_ROWS = [12, 13] as const;
/** The "Town" signpost (1×2 sprite) above the gate. */
export const YARD_SIGN: Tile = { x: 0, y: 11 };
/** Yard tiles kept free of garden items. */
export const YARD_RESERVED: readonly Rect[] = [
  { x: YARD_HOUSE.x, y: 0, w: YARD_HOUSE.maxWidth, h: YARD_HOUSE.height }, // the house
  { x: YARD_DOORSTEP.x, y: YARD_DOORSTEP.y, w: 2, h: YARD.height - YARD_DOORSTEP.y }, // path down
  { x: 0, y: YARD_GATE_ROWS[0], w: YARD_DOORSTEP.x, h: 2 }, // path to the gate
  { x: YARD_SIGN.x, y: YARD_SIGN.y, w: 1, h: 1 }, // signpost
];

const inRect = (r: Rect, t: Tile) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
export const yardReserved = (t: Tile) => YARD_RESERVED.some((r) => inRect(r, t));

/** Grid size of a room, or of the yard. */
export const roomDims = (d: HouseDims, room: number) =>
  room === YARD_ROOM ? { width: YARD.width, height: YARD.height } : d;

// ---------------------------------------------------------------------------------------------
// Placement rules
// ---------------------------------------------------------------------------------------------

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
 * Can `candidate` go into a home that already has `existing` placed? Ownership counts are
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
  const outside = candidate.room === YARD_ROOM;
  if (!outside && (candidate.room < 0 || candidate.room >= dims.rooms)) return fail('No such room');
  if (item.category === 'garden' && !outside) return fail('Garden items go in the yard');
  if (item.category !== 'garden' && outside) return fail('Only garden items go outside');

  const { x, y } = candidate;
  const { w, h } = item.size;
  const room = roomDims(dims, candidate.room);
  if (x < 0 || x + w > room.width) return fail('Outside the room');
  if (outside) {
    if (y < 0 || y + h > room.height) return fail('Outside the yard');
  } else if (item.layer === 'wall') {
    if (y !== 0 || h !== 1) return fail('Wall items go on the top wall');
  } else if (y < 1 || y + h > room.height) {
    return fail(y < 1 ? 'Only wall items go on the wall' : 'Outside the room');
  }

  const tiles = coveredTiles(item, candidate);
  if (outside && tiles.some(yardReserved)) return fail('Keep the house and paths clear');
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
  if (item.layer === 'floor' && !outside) {
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
// The home as a walkable world (shared by the client renderer and server movement checks)
// ---------------------------------------------------------------------------------------------

/**
 * Yard (with its fence ring) on the left, then the interior with its outer wall, far enough
 * apart that the camera never shows one from the other.
 */
const YARD_WORLD_W = YARD.width + 2;
const INTERIOR_X = YARD_WORLD_W + 40;

const feetAt = (t: Tile) => ({
  x: t.x * TILE_SIZE + TILE_SIZE / 2,
  y: t.y * TILE_SIZE + TILE_SIZE - 2,
});

/**
 * World layout in tiles. The yard's fence ring is the border around the yard; the interior has
 * a 1-tile outer wall all around, rooms side by side separated by a 1-tile wall with a doorway
 * at `linkY`, and the exit in the bottom wall below the front door.
 */
export const houseWorld = {
  width: (d: HouseDims) => INTERIOR_X + d.rooms * d.width + (d.rooms - 1) + 2,
  height: (d: HouseDims) => Math.max(YARD.height, d.height) + 2,
  roomOrigin: (d: HouseDims, room: number): Tile =>
    room === YARD_ROOM ? { x: 1, y: 1 } : { x: INTERIOR_X + 1 + room * (d.width + 1), y: 1 },
  /** The two zones in tiles, for camera bounds. */
  yardBounds: (): Rect => ({ x: 0, y: 0, w: YARD_WORLD_W, h: YARD.height + 2 }),
  interiorBounds: (d: HouseDims): Rect => ({
    x: INTERIOR_X,
    y: 0,
    w: d.rooms * d.width + (d.rooms - 1) + 2,
    h: d.height + 2,
  }),
  isInside: (x: number) => x >= INTERIOR_X * TILE_SIZE,
  exitTile: (d: HouseDims): Tile => ({ x: INTERIOR_X + 1 + doorX(d), y: d.height + 1 }),
  doorstepTile: (): Tile => ({ x: 1 + YARD_DOORSTEP.x, y: 1 + YARD_DOORSTEP.y }),
  gateTiles: (): Tile[] => YARD_GATE_ROWS.map((r) => ({ x: 0, y: 1 + r })),
  /** Feet position just inside the front door. */
  insideSpawn: (d: HouseDims) => feetAt({ x: INTERIOR_X + 1 + doorX(d), y: d.height }),
  /** Feet position on the doorstep outside. */
  doorstepSpawn: () => feetAt({ x: 1 + YARD_DOORSTEP.x, y: 1 + YARD_DOORSTEP.y }),
  /** Feet position for someone arriving from town, just inside the gate. */
  arrivalSpawn: () => feetAt({ x: 2, y: 1 + YARD_GATE_ROWS[0] }),
};

const tileOf = (p: { x: number; y: number }): Tile => ({
  x: Math.floor(p.x / TILE_SIZE),
  y: Math.floor((p.y - 1) / TILE_SIZE),
});
const sameTile = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;

/** Feet on the yard doorstep (go inside). */
export const atFrontDoor = (p: { x: number; y: number }) =>
  sameTile(tileOf(p), houseWorld.doorstepTile());

/** Feet on the inside exit, or the floor tile just above it (go out to the yard). */
export function atExit(d: HouseDims, p: { x: number; y: number }): boolean {
  const t = tileOf(p);
  const exit = houseWorld.exitTile(d);
  return t.x === exit.x && (t.y === exit.y || t.y === exit.y - 1);
}

/** Feet in the gap in the yard fence (leave for town). */
export const atGate = (p: { x: number; y: number }) =>
  houseWorld.gateTiles().some((g) => sameTile(tileOf(p), g));

export function houseCollisionGrid(
  dims: HouseDims,
  placements: readonly Placement[],
  lookup: ItemLookup = catalogLookup,
  exteriorWidth: number = YARD_HOUSE.maxWidth,
): CollisionGrid {
  const width = houseWorld.width(dims);
  const height = houseWorld.height(dims);
  const solid = new Uint8Array(width * height).fill(1);
  const set = (x: number, y: number, v: 0 | 1) => {
    if (x >= 0 && y >= 0 && x < width && y < height) solid[y * width + x] = v;
  };
  // Yard: open inside the fence, the gate open, the house itself solid.
  const yard = houseWorld.roomOrigin(dims, YARD_ROOM);
  for (let y = 0; y < YARD.height; y++)
    for (let x = 0; x < YARD.width; x++) set(yard.x + x, yard.y + y, 0);
  for (const g of houseWorld.gateTiles()) set(g.x, g.y, 0);
  for (let y = 0; y < YARD_HOUSE.height; y++)
    for (let x = 0; x < exteriorWidth; x++) set(yard.x + YARD_HOUSE.x + x, yard.y + y, 1);
  // Interior: floor rows open; row 0 (the wall) stays solid.
  for (let r = 0; r < dims.rooms; r++) {
    const o = houseWorld.roomOrigin(dims, r);
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

/** Seats in front of (below) desks and tables, inside or in the yard, where people can focus. */
export function studySeats(
  dims: HouseDims,
  placements: readonly (Placement & { id: string })[],
  lookup: ItemLookup = catalogLookup,
  exteriorWidth?: number,
): StudySeat[] {
  const grid = houseCollisionGrid(dims, placements, lookup, exteriorWidth);
  const seats: StudySeat[] = [];
  for (const p of placements) {
    const item = lookup(p.itemId);
    if (!item?.studySpot) continue;
    const o = houseWorld.roomOrigin(dims, p.room);
    const y = p.y + item.size.h;
    if (y >= roomDims(dims, p.room).height) continue;
    for (let dx = 0; dx < item.size.w; dx++) {
      const tile = { x: o.x + p.x + dx, y: o.y + y };
      if (grid.solid[tile.y * grid.width + tile.x] === 0) seats.push({ id: `${p.id}:${dx}`, tile });
    }
  }
  return seats;
}
