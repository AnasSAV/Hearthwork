/**
 * The town map as the editor sees it: the Tiled JSON the game loads, edited in place. Tile
 * layers are flat gid arrays (0 = empty); the `collision` layer marks solid tiles with the
 * collision tileset's gid; objects (desks, buildings, trees, animations, flowers, spawn) live in
 * the `objects` group in pixels.
 */

export const T = 16;
export const TILE_LAYERS = [
  'ground',
  'paths',
  'decor',
  'below',
  'below2',
  'above',
  'above2',
] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];
export type LayerName = TileLayer | 'collision';
export const ALL_LAYERS: readonly LayerName[] = [...TILE_LAYERS, 'collision'];

export interface Property {
  name: string;
  type: string;
  value: string | number | boolean;
}

export interface MapObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  properties?: Property[];
}

export interface Tileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  columns: number;
  tilecount: number;
}

interface Layer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  width?: number;
  height?: number;
  visible: boolean;
  data?: number[];
  objects?: MapObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  nextobjectid: number;
  nextlayerid: number;
  layers: Layer[];
  tilesets: Tileset[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A copied piece of map: tiles per layer (row-major w×h) and objects relative to its corner. */
export interface Stamp {
  w: number;
  h: number;
  layers: Partial<Record<LayerName, number[]>>;
  objects: MapObject[];
}

export interface Issue {
  level: 'error' | 'warning';
  text: string;
  /** Where to look, in map pixels. */
  at?: { x: number; y: number };
}

export function getProp<V extends Property['value']>(o: MapObject, name: string): V | undefined {
  return o.properties?.find((p) => p.name === name)?.value as V | undefined;
}

export function setProp(o: MapObject, name: string, value: Property['value']): void {
  const type =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? 'int'
        : 'float'
      : typeof value === 'boolean'
        ? 'bool'
        : 'string';
  o.properties ??= [];
  const p = o.properties.find((q) => q.name === name);
  if (p) {
    p.value = value;
    p.type = type;
  } else o.properties.push({ name, type, value });
}

/** The point that decides which tile an object belongs to (for region selection). */
export function anchorOf(o: MapObject): { x: number; y: number } {
  if (o.point) return { x: o.x, y: o.y };
  if (o.type === 'tree' || o.type === 'anim')
    return { x: o.x + o.width / 2, y: o.y + o.height - 8 };
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

/** Solid footprint of a tree in tiles: the middle column(s) of its bottom rows (as build_town.py). */
export function trunkCells(o: MapObject): { x: number; y: number }[] {
  const w = Math.round(o.width / T);
  const h = Math.round(o.height / T);
  const rows = getProp<number>(o, 'trunk') ?? 2;
  const cols = w >= 4 ? [w / 2 - 1, w / 2] : w === 2 ? [0, 1] : [Math.floor(w / 2)];
  const tx = Math.floor(o.x / T);
  const ty = Math.floor(o.y / T);
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (const c of cols) out.push({ x: tx + Math.floor(c), y: ty + h - 1 - r });
  return out;
}

export class TownDoc {
  json: TiledMap;

  constructor(json: TiledMap) {
    this.json = json;
  }

  get w(): number {
    return this.json.width;
  }
  get h(): number {
    return this.json.height;
  }
  get tiles(): Tileset {
    return this.json.tilesets.find((t) => t.name !== 'collision')!;
  }
  get collisionGid(): number {
    return this.json.tilesets.find((t) => t.name === 'collision')!.firstgid;
  }
  get objects(): MapObject[] {
    const g = this.json.layers.find((l) => l.type === 'objectgroup');
    if (!g) throw new Error('Map has no object layer');
    g.objects ??= [];
    return g.objects;
  }
  data(name: LayerName): number[] {
    const l = this.json.layers.find((q) => q.name === name && q.type === 'tilelayer');
    if (!l?.data) throw new Error(`Map has no "${name}" layer`);
    return l.data;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(name: LayerName, x: number, y: number): number {
    return this.inside(x, y) ? this.data(name)[y * this.w + x]! : 0;
  }
  set(name: LayerName, x: number, y: number, gid: number): void {
    if (this.inside(x, y)) this.data(name)[y * this.w + x] = gid;
  }
  solid(x: number, y: number): boolean {
    return !this.inside(x, y) || this.get('collision', x, y) !== 0;
  }
  setSolid(x: number, y: number, on: boolean): void {
    this.set('collision', x, y, on ? this.collisionGid : 0);
  }

  snapshot(): string {
    return JSON.stringify(this.json);
  }
  restore(s: string): void {
    this.json = JSON.parse(s) as TiledMap;
  }

  newId(): number {
    return this.json.nextobjectid++;
  }

  objectsIn(r: Rect): MapObject[] {
    return this.objects.filter((o) => {
      const a = anchorOf(o);
      return a.x >= r.x * T && a.x < (r.x + r.w) * T && a.y >= r.y * T && a.y < (r.y + r.h) * T;
    });
  }

  copy(r: Rect, layers: readonly LayerName[], withObjects: boolean): Stamp {
    const stamp: Stamp = { w: r.w, h: r.h, layers: {}, objects: [] };
    for (const name of layers) {
      const out: number[] = [];
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) out.push(this.get(name, r.x + x, r.y + y));
      stamp.layers[name] = out;
    }
    if (withObjects) {
      stamp.objects = this.objectsIn(r).map((o) => {
        const c = structuredClone(o);
        shiftObject(c, -r.x * T, -r.y * T);
        return c;
      });
    }
    return stamp;
  }

  clear(r: Rect, layers: readonly LayerName[], withObjects: boolean): void {
    for (const name of layers)
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) this.set(name, r.x + x, r.y + y, 0);
    if (withObjects) {
      const gone = new Set(this.objectsIn(r).filter((o) => o.type !== 'spawn'));
      const g = this.objects;
      for (let i = g.length - 1; i >= 0; i--) if (gone.has(g[i]!)) g.splice(i, 1);
    }
  }

  /** Writes a stamp's tiles at (tx, ty). Empty stamp cells are written too unless `overlay`. */
  writeTiles(s: Stamp, tx: number, ty: number, overlay = false): void {
    for (const [name, cells] of Object.entries(s.layers) as [LayerName, number[]][]) {
      for (let y = 0; y < s.h; y++)
        for (let x = 0; x < s.w; x++) {
          const v = cells[y * s.w + x]!;
          if (overlay && v === 0) continue;
          this.set(name, tx + x, ty + y, v);
        }
    }
  }

  /** Moves a region (tiles on the given layers, and the objects in it) by whole tiles. */
  move(r: Rect, dx: number, dy: number, layers: readonly LayerName[], withObjects: boolean): void {
    const s = this.copy(r, layers, false);
    const moving = withObjects ? this.objectsIn(r) : [];
    this.clear(r, layers, false);
    this.writeTiles(s, r.x + dx, r.y + dy);
    for (const o of moving) shiftObject(o, dx * T, dy * T);
  }

  /**
   * Pastes a copy: new object ids, desks renamed so each seat stays unique (and a pasted table
   * group becomes a new group). Buildings and the spawn are never duplicated.
   */
  paste(s: Stamp, tx: number, ty: number, overlay: boolean): { skipped: number } {
    this.writeTiles(s, tx, ty, overlay);
    let skipped = 0;
    const deskNames = new Set(this.objects.filter((o) => o.type === 'desk').map((o) => o.name));
    const tableNames = new Set(
      this.objects.map((o) => getProp<string>(o, 'table')).filter(Boolean),
    );
    const renamedTables = new Map<string, string>();
    let n = 1;
    for (const src of s.objects) {
      if (src.type === 'building' || src.type === 'spawn') {
        skipped++;
        continue;
      }
      const o = structuredClone(src);
      o.id = this.newId();
      shiftObject(o, tx * T, ty * T);
      if (o.type === 'desk') {
        while (deskNames.has(`desk-${n}`)) n++;
        o.name = `desk-${n}`;
        deskNames.add(o.name);
        const table = getProp<string>(o, 'table');
        if (table) {
          let renamed = renamedTables.get(table);
          if (!renamed) {
            let k = 2;
            while (tableNames.has(`${table.replace(/-\d+$/, '')}-${k}`)) k++;
            renamed = `${table.replace(/-\d+$/, '')}-${k}`;
            tableNames.add(renamed);
            renamedTables.set(table, renamed);
          }
          setProp(o, 'table', renamed);
        }
      }
      this.objects.push(o);
    }
    return { skipped };
  }

  /** Grows (or shrinks, with negative numbers) the map on each side; new ground is `fill`. */
  resize(left: number, top: number, right: number, bottom: number, fill: number): number {
    const w = this.w + left + right;
    const h = this.h + top + bottom;
    if (w < 10 || h < 10 || w > 300 || h > 300)
      throw new Error('The map must stay between 10 and 300 tiles a side');
    for (const l of this.json.layers) {
      if (l.type !== 'tilelayer' || !l.data) continue;
      const out = new Array<number>(w * h).fill(l.name === 'ground' ? fill : 0);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const sx = x - left;
          const sy = y - top;
          if (sx >= 0 && sy >= 0 && sx < this.w && sy < this.h)
            out[y * w + x] = l.data[sy * this.w + sx]!;
        }
      l.data = out;
      l.width = w;
      l.height = h;
    }
    this.json.width = w;
    this.json.height = h;
    for (const o of this.objects) shiftObject(o, left * T, top * T);
    // Objects that ended up off the map are dropped (trees may hang over the edge).
    const before = this.objects.length;
    const g = this.objects;
    for (let i = g.length - 1; i >= 0; i--) {
      const a = anchorOf(g[i]!);
      if (g[i]!.type !== 'spawn' && (a.x < 0 || a.y < 0 || a.x >= w * T || a.y >= h * T))
        g.splice(i, 1);
    }
    return before - g.length;
  }

  /** Most common ground tile, used to fill new space. */
  commonGround(): number {
    const count = new Map<number, number>();
    for (const v of this.data('ground')) if (v) count.set(v, (count.get(v) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  }

  setTreeTrunk(o: MapObject, on: boolean): void {
    for (const c of trunkCells(o)) this.setSolid(c.x, c.y, on);
  }

  /** Checks the things the game depends on. */
  validate(): Issue[] {
    const issues: Issue[] = [];
    const spawns = this.objects.filter((o) => o.type === 'spawn');
    if (spawns.length !== 1)
      issues.push({
        level: 'error',
        text: `There must be exactly one spawn point (found ${spawns.length}).`,
      });
    const spawn = spawns[0];
    const tileOf = (x: number, y: number) => ({ x: Math.floor(x / T), y: Math.floor(y / T) });
    let reach: Uint8Array | null = null;
    if (spawn) {
      const s = tileOf(spawn.x, spawn.y);
      if (this.solid(s.x, s.y))
        issues.push({ level: 'error', text: 'The spawn point is on a solid tile.', at: spawn });
      else reach = this.reachable(s.x, s.y);
    }
    const seen = new Map<string, MapObject>();
    for (const d of this.objects.filter((o) => o.type === 'desk')) {
      if (seen.has(d.name))
        issues.push({ level: 'error', text: `Two desks are called "${d.name}".`, at: d });
      seen.set(d.name, d);
      const seat = tileOf(d.x + d.width / 2, d.y + d.height - 2);
      if (!this.inside(seat.x, seat.y)) {
        issues.push({ level: 'error', text: `${d.name} is off the map.`, at: d });
        continue;
      }
      const near = [
        seat,
        ...[
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map(([dx, dy]) => ({ x: seat.x + dx!, y: seat.y + dy! })),
      ];
      if (reach && !near.some((p) => this.inside(p.x, p.y) && reach[p.y * this.w + p.x]))
        issues.push({
          level: 'warning',
          text: `${d.name} can't be reached from the spawn.`,
          at: d,
        });
    }
    for (const b of this.objects.filter((o) => o.type === 'building')) {
      const dx = getProp<number>(b, 'doorX');
      const dy = getProp<number>(b, 'doorY');
      if (dx === undefined || dy === undefined) continue;
      const door = tileOf(dx, dy);
      const near = [door, { x: door.x, y: door.y + 1 }];
      if (reach && !near.some((p) => this.inside(p.x, p.y) && reach[p.y * this.w + p.x]))
        issues.push({
          level: 'warning',
          text: `The ${b.name} door can't be reached from the spawn.`,
          at: { x: dx, y: dy },
        });
    }
    return issues;
  }

  private reachable(sx: number, sy: number): Uint8Array {
    const seen = new Uint8Array(this.w * this.h);
    const queue = [sy * this.w + sx];
    seen[queue[0]!] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % this.w;
      const y = (i - x) / this.w;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        const j = ny * this.w + nx;
        if (this.inside(nx, ny) && !seen[j] && !this.solid(nx, ny)) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    return seen;
  }
}

/** Moves an object (and a building's door) by a pixel offset. */
export function shiftObject(o: MapObject, dx: number, dy: number): void {
  o.x += dx;
  o.y += dy;
  if (o.type === 'building') {
    const doorX = getProp<number>(o, 'doorX');
    const doorY = getProp<number>(o, 'doorY');
    if (doorX !== undefined) setProp(o, 'doorX', doorX + dx);
    if (doorY !== undefined) setProp(o, 'doorY', doorY + dy);
  }
}
