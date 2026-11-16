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

export interface GroundTiles {
  /** Bottom: grass, sand or sea. */
  ground: Frame;
  /** Paving or water, over the ground. */
  path?: Frame;
  /** Planks, over the water. */
  top?: Frame;
}

/** What a ground tile looks like. */
export function groundFrames(kit: Kit, town: Town, x: number, y: number): GroundTiles {
  const g = town.groundAt(x, y);
  const grass = tileHash(x, y) < 0.2 ? kit.terrain.grass[1]! : kit.terrain.grass[0]!;
  // Off the map counts as the nearest tile on it, so areas run cleanly off the edge.
  const at = (sx: number, sy: number) =>
    town.groundAt(
      Math.max(0, Math.min(town.width - 1, sx)),
      Math.max(0, Math.min(town.height - 1, sy)),
    );
  /**
   * Planks lie on whatever is around them: water if they touch water (a pier), otherwise the
   * sea, sand or grass beside them (a boardwalk or deck).
   */
  const plankBase = (px: number, py: number): 'water' | 'sea' | 'sand' | 'grass' => {
    const near = (ch: string) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (at(px + dx, py + dy) === ch) return true;
      return false;
    };
    return near(GROUND.water)
      ? 'water'
      : near(GROUND.sea)
        ? 'sea'
        : near(GROUND.sand)
          ? 'sand'
          : 'grass';
  };
  // An area's edge tiles join up under planks lying on it.
  const inArea = (ch: string, base: 'water' | 'sand') => (sx: number, sy: number) => {
    const c = at(sx, sy);
    return c === ch || (c === GROUND.planks && plankBase(sx, sy) === base);
  };
  const shoreBody = (sx: number, sy: number) => {
    const c = at(sx, sy);
    return c !== GROUND.sea && !(c === GROUND.planks && plankBase(sx, sy) === 'sea');
  };
  switch (g) {
    case GROUND.sand: {
      // Sand by the sea has a foamy shore; sand in grass a grassy edge.
      let bySea = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === GROUND.sea) bySea = true;
      return bySea
        ? { ground: pickAutotile(kit.terrain.shore, shoreBody, x, y) }
        : { ground: pickAutotile(kit.terrain.sand, inArea(GROUND.sand, 'sand'), x, y) };
    }
    case GROUND.sea:
      return { ground: kit.terrain.sea };
    case GROUND.water:
      return {
        ground: grass,
        path: pickAutotile(kit.terrain.water, inArea(GROUND.water, 'water'), x, y),
      };
    case GROUND.planks: {
      const base = plankBase(x, y);
      const top = kit.terrain.planks;
      if (base === 'water') {
        // Water runs on under a pier, so its banks stay where the water is.
        return {
          ground: grass,
          path: pickAutotile(kit.terrain.water, inArea(GROUND.water, 'water'), x, y),
          top,
        };
      }
      if (base === 'sea') return { ground: kit.terrain.sea, top };
      if (base === 'sand') {
        const bySea = [-1, 0, 1].some((dy) =>
          [-1, 0, 1].some((dx) => at(x + dx, y + dy) === GROUND.sea),
        );
        return {
          ground: bySea
            ? pickAutotile(kit.terrain.shore, shoreBody, x, y)
            : pickAutotile(kit.terrain.sand, inArea(GROUND.sand, 'sand'), x, y),
          top,
        };
      }
      return { ground: grass, top };
    }
    case GROUND.paving: {
      const blocks = kit.terrain.paving;
      const block = blocks[Math.floor(tileHash(x >> 1, y >> 1) * blocks.length)]!;
      return { ground: grass, path: block[(y % 2) * 2 + (x % 2)]! };
    }
    default:
      return { ground: grass };
  }
}
