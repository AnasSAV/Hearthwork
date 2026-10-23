import {
  collisionGridFromTiled,
  DIRECTIONS,
  findObjects,
  getProperty,
  MapObjectType,
  type CollisionGrid,
  type Direction,
  type TiledMap,
  type Vec2,
} from '@focus-town/shared';
// Bundled at build time (esbuild/tsx), so the server never reads the map from disk at runtime.
import townJson from '../../client/public/assets/maps/town.json' with { type: 'json' };

export interface Desk {
  id: string;
  /** Group table this seat belongs to, if any (shared Pomodoro later). */
  table: string | null;
  /** Where a seated player's feet go. */
  seat: Vec2;
  facing: Direction;
  rect: { x: number; y: number; width: number; height: number };
}

export interface Plot {
  plotIndex: number;
  /** Feet position on the doorstep, just below the door. */
  doorstep: Vec2;
}

export interface LoadedMap {
  grid: CollisionGrid;
  spawn: Vec2;
  desks: Map<string, Desk>;
  plots: Map<number, Plot>;
}

function load(map: TiledMap): LoadedMap {
  const grid = collisionGridFromTiled(map);
  const spawnObj = findObjects(map, MapObjectType.Spawn)[0];
  if (!spawnObj) throw new Error('Map has no spawn point');

  const desks = new Map<string, Desk>();
  for (const o of findObjects(map, MapObjectType.Desk)) {
    const facing = getProperty<string>(o, 'facing');
    desks.set(o.name, {
      id: o.name,
      table: getProperty<string>(o, 'table') ?? null,
      seat: { x: o.x + o.width / 2, y: o.y + o.height - 2 },
      facing: (DIRECTIONS as readonly string[]).includes(facing ?? '')
        ? (facing as Direction)
        : 'up',
      rect: { x: o.x, y: o.y, width: o.width, height: o.height },
    });
  }
  const plots = new Map<number, Plot>();
  for (const o of findObjects(map, MapObjectType.Plot)) {
    const plotIndex = getProperty<number>(o, 'plotIndex');
    const doorX = getProperty<number>(o, 'doorX');
    const doorY = getProperty<number>(o, 'doorY');
    if (plotIndex === undefined || doorX === undefined || doorY === undefined) continue;
    plots.set(plotIndex, { plotIndex, doorstep: { x: doorX, y: doorY + 10 } });
  }
  return { grid, spawn: { x: spawnObj.x, y: spawnObj.y }, desks, plots };
}

export const townMap: LoadedMap = load(townJson as TiledMap);

/** True if feet at `p` are on (or right next to) the desk's seat tile. */
export function isAtDesk(desk: Desk, p: Vec2, slack = 6): boolean {
  const r = desk.rect;
  return (
    p.x >= r.x - slack &&
    p.x <= r.x + r.width + slack &&
    p.y >= r.y - slack &&
    p.y <= r.y + r.height + slack
  );
}
