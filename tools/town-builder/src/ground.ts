import type { Autotile, Frame, Kit } from './kit';
import { GROUND, type Town } from './layout';

/** A stable pseudo-random number per tile, so grass and paving look the same on every draw. */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The edge tile for a cell of an area (water, sand) given which neighbours are inside it. */
export function pickAutotile(
  tile: Autotile,
  inArea: (x: number, y: number) => boolean,
  x: number,
  y: number,
): Frame {
  const n = inArea(x, y - 1);
  const s = inArea(x, y + 1);
  const w = inArea(x - 1, y);
  const e = inArea(x + 1, y);
  const c = !w ? 0 : !e ? 2 : 1;
  const r = !n ? 0 : !s ? 2 : 1;
  if (c !== 1 || r !== 1) return tile.slice[r * 3 + c]!;
  if (!inArea(x - 1, y - 1)) return tile.inner[3]!;
  if (!inArea(x + 1, y - 1)) return tile.inner[2]!;
  if (!inArea(x - 1, y + 1)) return tile.inner[1]!;
  if (!inArea(x + 1, y + 1)) return tile.inner[0]!;
  return tile.slice[4]!;
}

/** What a ground tile looks like: a bottom tile, and an optional one on top (paving, water). */
export function groundFrames(
  kit: Kit,
  town: Town,
  x: number,
  y: number,
): { ground: Frame; path?: Frame } {
  const g = town.groundAt(x, y);
  const grass = tileHash(x, y) < 0.2 ? kit.terrain.grass[1]! : kit.terrain.grass[0]!;
  // Out of the map counts as the same ground, so areas run cleanly off the edge.
  const same = (ch: string) => (sx: number, sy: number) =>
    !town.inside(sx, sy)
      ? town.groundAt(
          Math.max(0, Math.min(town.width - 1, sx)),
          Math.max(0, Math.min(town.height - 1, sy)),
        ) === ch
      : town.groundAt(sx, sy) === ch;
  switch (g) {
    case GROUND.sand:
      return { ground: pickAutotile(kit.terrain.sand, same(GROUND.sand), x, y) };
    case GROUND.water:
      return { ground: grass, path: pickAutotile(kit.terrain.water, same(GROUND.water), x, y) };
    case GROUND.paving: {
      const blocks = kit.terrain.paving;
      const block = blocks[Math.floor(tileHash(x >> 1, y >> 1) * blocks.length)]!;
      return { ground: grass, path: block[(y % 2) * 2 + (x % 2)]! };
    }
    default:
      return { ground: grass };
  }
}
