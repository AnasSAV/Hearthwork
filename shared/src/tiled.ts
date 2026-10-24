/** Minimal subset of the Tiled JSON map format that we read outside of Phaser. */
export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}

export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  /** Tiled ≥1.9 writes `class` instead of `type`. */
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledTileLayer {
  type: 'tilelayer';
  name: string;
  width: number;
  height: number;
  data: number[];
  visible: boolean;
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  name: string;
  objects: TiledObject[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer;

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

/** Layer names the game relies on. Keep in sync with the .tmx files. */
export const MapLayer = {
  Collision: 'collision',
  Objects: 'objects',
} as const;

/** Object `type`/`class` values in the objects layer. */
export const MapObjectType = {
  Spawn: 'spawn',
  Desk: 'desk',
  /** Animated piece (flag, fish…); properties `frames` and `fps`. */
  Anim: 'anim',
  /** A tree sprite (frame = object name in the trees atlas); property `trunk` rows. */
  Tree: 'tree',
  /** A flower bed (butterflies hover around these). */
  Flowers: 'flowers',
  Building: 'building',
} as const;

export function objectType(o: TiledObject): string {
  return o.type ?? o.class ?? '';
}

export function getProperty<T>(o: TiledObject, name: string): T | undefined {
  return o.properties?.find((p) => p.name === name)?.value as T | undefined;
}

export function findObjectLayer(map: TiledMap, name: string): TiledObjectLayer | undefined {
  return map.layers.find((l): l is TiledObjectLayer => l.type === 'objectgroup' && l.name === name);
}

export function findTileLayer(map: TiledMap, name: string): TiledTileLayer | undefined {
  return map.layers.find((l): l is TiledTileLayer => l.type === 'tilelayer' && l.name === name);
}

export function findObjects(map: TiledMap, type: string): TiledObject[] {
  return (
    findObjectLayer(map, MapLayer.Objects)?.objects.filter((o) => objectType(o) === type) ?? []
  );
}
