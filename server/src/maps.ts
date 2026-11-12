import {
  canStand,
  collisionGridFromTiled,
  DIRECTIONS,
  findObjects,
  getProperty,
  MapObjectType,
  type CollisionGrid,
  type Direction,
  type GameId,
  type TiledMap,
  type Vec2,
} from '@focus-town/shared';
// Bundled at build time (esbuild/tsx), so the server never reads the map from disk at runtime.
import coveJson from '../../client/public/assets/maps/cove.json' with { type: 'json' };
import lakeJson from '../../client/public/assets/maps/lake.json' with { type: 'json' };
import meadowJson from '../../client/public/assets/maps/meadow.json' with { type: 'json' };
import rapidsJson from '../../client/public/assets/maps/rapids.json' with { type: 'json' };
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

export interface LoadedMap {
  grid: CollisionGrid;
  spawn: Vec2;
  desks: Map<string, Desk>;
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
  return { grid, spawn: { x: spawnObj.x, y: spawnObj.y }, desks };
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a mini-game's rules need to know about its map. */
export interface GameMap {
  grid: CollisionGrid;
  /** Rapids: where a raft can't go. */
  raftGrid: CollisionGrid | null;
  spawn: Vec2;
  bounds: Rect;
  fishZones: Rect[];
  launch: Rect | null;
  /** Where a raft goes in. */
  start: Vec2 | null;
  finish: Rect | null;
  buoys: { id: string; x: number; y: number }[];
  flowers: Vec2[];
  digZone: Rect | null;
}

function loadGame(map: TiledMap): GameMap {
  const grid = collisionGridFromTiled(map);
  const spawnObj = findObjects(map, MapObjectType.Spawn)[0];
  if (!spawnObj) throw new Error('Game map has no spawn point');
  const launch = findObjects(map, MapObjectType.Launch)[0] ?? null;
  const raftGrid = map.layers.some((l) => l.name === 'raft')
    ? collisionGridFromTiled(map, 'raft')
    : null;
  const startX = launch && getProperty<number>(launch, 'startX');
  const startY = launch && getProperty<number>(launch, 'startY');
  const start =
    startX !== undefined && startY !== undefined && startX !== null && startY !== null
      ? { x: startX, y: startY }
      : null;
  if (start && raftGrid && !canStand(raftGrid, start.x, start.y)) {
    throw new Error('The raft start is not on open water');
  }
  return {
    grid,
    raftGrid,
    spawn: { x: spawnObj.x, y: spawnObj.y },
    bounds: {
      x: 2 * map.tilewidth,
      y: 2 * map.tileheight,
      width: (map.width - 4) * map.tilewidth,
      height: (map.height - 4) * map.tileheight,
    },
    fishZones: findObjects(map, MapObjectType.FishZone),
    launch,
    start,
    finish: findObjects(map, MapObjectType.Finish)[0] ?? null,
    buoys: findObjects(map, MapObjectType.Buoy).map((b) => ({ id: b.name, x: b.x, y: b.y })),
    flowers: findObjects(map, MapObjectType.Flowers).map((f) => ({
      x: f.x + f.width / 2,
      y: f.y + f.height / 2,
    })),
    digZone: findObjects(map, MapObjectType.DigZone)[0] ?? null,
  };
}

export const gameMaps: Record<GameId, GameMap> = {
  fishing: loadGame(lakeJson as TiledMap),
  rafting: loadGame(rapidsJson as TiledMap),
  butterflies: loadGame(meadowJson as TiledMap),
  treasure: loadGame(coveJson as TiledMap),
};
