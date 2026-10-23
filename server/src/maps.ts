import {
  collisionGridFromTiled,
  findObjects,
  MapObjectType,
  type CollisionGrid,
  type TiledMap,
  type Vec2,
} from '@focus-town/shared';
// Bundled at build time (esbuild/tsx), so the server never reads the map from disk at runtime.
import townJson from '../../client/public/assets/maps/town.json' with { type: 'json' };

export interface LoadedMap {
  grid: CollisionGrid;
  spawn: Vec2;
}

function load(map: TiledMap): LoadedMap {
  const grid = collisionGridFromTiled(map);
  const spawnObj = findObjects(map, MapObjectType.Spawn)[0];
  if (!spawnObj) throw new Error('Map has no spawn point');
  return { grid, spawn: { x: spawnObj.x, y: spawnObj.y } };
}

export const townMap: LoadedMap = load(townJson as TiledMap);
