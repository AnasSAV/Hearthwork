import { groundFrames } from './ground';
import { T, type Frame, type Kit, type Prefab } from './kit';
import { GROUND, type Piece, type Town } from './layout';
import { toTmx, type TiledMap, type TiledObject } from './tmx';

/**
 * Turn a layout into what the game loads, in the same shape tools/art/build_town.py writes:
 *   maps/town.json + town.tmx   tile layers, hidden collision layer, objects
 *   tilesets/town.png           every tile used, deduplicated
 *   sprites/town-trees.*        every tree in the kit (the world map draws some of them too)
 *   sprites/town-anims.*        every animation in the kit, frames "<name>:<i>"
 *   sprites/town-map.png        a small picture of the town for the world map
 */
const TILE_LAYERS = ['ground', 'paths', 'decor', 'below', 'below2', 'above', 'above2'] as const;
type TileLayer = (typeof TILE_LAYERS)[number];
const COLS = 32;

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** Tile to show. */
  at?: { x: number; y: number };
}

export interface Compiled {
  map: TiledMap;
  tmx: string;
  tileset: string;
  trees: { png: string; json: string };
  anims: { png: string; json: string };
  picture: string;
  issues: Issue[];
}

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

const atlasFrame = (x: number, y: number, w: number, h: number): AtlasFrame => ({
  frame: { x, y, w, h },
  rotated: false,
  trimmed: false,
  spriteSourceSize: { x: 0, y: 0, w, h },
  sourceSize: { w, h },
});

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** A short content hash, so the game can tell a new tileset from a cached old one. */
function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function compile(town: Town, kit: Kit, art: HTMLImageElement): Compiled {
  const W = town.width;
  const H = town.height;
  const [atlasCanvas, atlasCtx] = canvas(art.width, art.height);
  atlasCtx.drawImage(art, 0, 0);

  // Tiles, deduplicated by their pixels.
  const tileKeys = new Map<string, number>();
  const tileSources: { x: number; y: number }[] = [];
  const bySource = new Map<string, number>();
  function gidOf(sx: number, sy: number): number {
    const sourceKey = `${sx},${sy}`;
    const known = bySource.get(sourceKey);
    if (known !== undefined) return known;
    const data = atlasCtx.getImageData(sx, sy, T, T).data;
    let opaque = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]) {
        opaque = true;
        break;
      }
    }
    let gid = 0;
    if (opaque) {
      let key = '';
      for (let i = 0; i < data.length; i += 4) {
        key += String.fromCharCode(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!);
      }
      gid = tileKeys.get(key) ?? 0;
      if (!gid) {
        tileSources.push({ x: sx, y: sy });
        gid = tileSources.length;
        tileKeys.set(key, gid);
      }
    }
    bySource.set(sourceKey, gid);
    return gid;
  }

  const layers: Record<TileLayer, number[]> = Object.fromEntries(
    TILE_LAYERS.map((n) => [n, new Array<number>(W * H).fill(0)]),
  ) as Record<TileLayer, number[]>;
  const solid = new Uint8Array(W * H);
  const at = (x: number, y: number) => y * W + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // 1. Ground.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = groundFrames(kit, town, x, y);
      layers.ground[at(x, y)] = gidOf(f.ground.x, f.ground.y);
      if (f.path) layers.paths[at(x, y)] = gidOf(f.path.x, f.path.y);
      if (town.groundAt(x, y) === GROUND.water) solid[at(x, y)] = 1;
    }
  }

  // 2. Pieces, back to front, so overlapping pictures stack the way they look in the builder.
  const objects: TiledObject[] = [];
  const object = (o: Omit<TiledObject, 'id' | 'rotation' | 'visible'>) =>
    objects.push({ id: objects.length + 1, rotation: 0, visible: true, ...o });
  const prop = (name: string, value: string | number | boolean) => ({
    name,
    type:
      typeof value === 'number'
        ? Number.isInteger(value)
          ? 'int'
          : 'float'
        : typeof value === 'boolean'
          ? 'bool'
          : 'string',
    value,
  });
  const ordered = [...town.layout.pieces].sort(
    (a, b) => a.y + town.prefabOf(a).h - (b.y + town.prefabOf(b).h) || a.x - b.x,
  );
  const issues: Issue[] = [];
  const seats: { x: number; y: number; name: string }[] = [];
  let deskCount = 0;
  let spawn: Piece | null = null;
  let shopDoor: { x: number; y: number }[] | null = null;

  function stampTiles(f: Prefab, p: Piece): void {
    for (let r = 0; r < f.h; r++) {
      for (let c = 0; c < f.w; c++) {
        const x = p.x + c;
        const y = p.y + r;
        if (!inside(x, y)) continue;
        const gid = gidOf(f.frame.x + c * T, f.frame.y + r * T);
        if (!gid) continue;
        if (f.layer === 'decor') {
          layers.decor[at(x, y)] = gid;
          continue;
        }
        const pair: TileLayer[] = r < f.above ? ['above', 'above2'] : ['below', 'below2'];
        const free = pair.find((n) => !layers[n][at(x, y)]);
        layers[free ?? pair[1]!][at(x, y)] = gid;
      }
    }
  }

  for (const p of ordered) {
    const f = town.prefabOf(p);
    for (const [c, r] of f.solid) if (inside(p.x + c, p.y + r)) solid[at(p.x + c, p.y + r)] = 1;
    switch (f.kind) {
      case 'tree':
        object({
          name: f.tree!.name,
          type: 'tree',
          x: p.x * T,
          y: p.y * T,
          width: f.w * T,
          height: f.h * T,
          properties: [prop('trunk', f.tree!.trunk)],
        });
        break;
      case 'anim':
        object({
          name: f.anim!.name,
          type: 'anim',
          x: p.x * T,
          y: p.y * T,
          width: f.w * T,
          height: f.h * T,
          properties: [prop('frames', f.anim!.frames), prop('fps', f.anim!.fps)],
        });
        break;
      case 'spawn':
        spawn = p;
        break;
      default:
        stampTiles(f, p);
    }
    if (f.building) {
      const props = [];
      // A piece without its own sign text shows the building's name.
      const label = p.label ?? f.building.label;
      if (label) props.push(prop('label', label));
      if (f.building.doorCol !== undefined) {
        props.push(prop('doorX', (p.x + f.building.doorCol) * T), prop('doorY', (p.y + f.h) * T));
        shopDoor = [
          { x: p.x + f.building.doorCol - 1, y: p.y + f.h },
          { x: p.x + f.building.doorCol, y: p.y + f.h },
        ];
      }
      // The game draws the sign at the top of this box, so it starts where the picture does.
      object({
        name: f.building.name,
        type: 'building',
        x: p.x * T,
        y: (p.y + f.top) * T,
        width: f.w * T,
        height: (f.h - f.top) * T,
        ...(props.length ? { properties: props } : {}),
      });
    }
    if (f.seats) {
      const table = f.group ? `table-${p.uid}` : null;
      for (const s of f.seats) {
        deskCount += 1;
        const name = `desk-${deskCount}`;
        const props = [prop('facing', s.facing)];
        if (table) props.push(prop('table', table));
        object({
          name,
          type: 'desk',
          x: (p.x + s.c) * T,
          y: (p.y + s.r) * T,
          width: T,
          height: T,
          properties: props,
        });
        seats.push({ x: p.x + s.c, y: p.y + s.r, name });
      }
    }
    if (f.flowers) {
      object({
        name: 'flowers',
        type: 'flowers',
        x: p.x * T,
        y: p.y * T,
        width: f.w * T,
        height: f.h * T,
      });
    }
    // Pieces left in a bad place by older layouts, map resizes or ground painting.
    if (!town.check(f, p.x, p.y, p).ok) {
      issues.push({
        level: 'warning',
        message: `${f.name}: ${town.check(f, p.x, p.y, p).reason}`,
        at: { x: p.x, y: p.y },
      });
    }
  }

  // 3. The arrival point, and whether everything can be reached from it.
  const spawnPiece = spawn as Piece | null;
  if (!spawnPiece) {
    issues.push({
      level: 'error',
      message: 'Place the arrival point (Special): players appear there.',
    });
  } else if (solid[at(spawnPiece.x, spawnPiece.y)]) {
    issues.push({
      level: 'error',
      message: 'The arrival point is on something solid.',
      at: spawnPiece,
    });
  } else {
    object({
      name: 'spawn',
      type: 'spawn',
      x: spawnPiece.x * T + T / 2,
      y: spawnPiece.y * T + T - 1,
      width: 0,
      height: 0,
      point: true,
    });
    const reached = new Uint8Array(W * H);
    const queue = [[spawnPiece.x, spawnPiece.y]];
    reached[at(spawnPiece.x, spawnPiece.y)] = 1;
    while (queue.length) {
      const [x, y] = queue.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x! + dx;
        const ny = y! + dy;
        if (!inside(nx, ny) || solid[at(nx, ny)] || reached[at(nx, ny)]) continue;
        reached[at(nx, ny)] = 1;
        queue.push([nx, ny]);
      }
    }
    const unreachable = seats.filter((s) => !reached[at(s.x, s.y)]);
    if (unreachable.length) {
      issues.push({
        level: 'warning',
        message: `${unreachable.length} ${unreachable.length === 1 ? 'seat' : 'seats'} can't be reached from the arrival point.`,
        at: unreachable[0],
      });
    }
    const door = shopDoor as { x: number; y: number }[] | null;
    if (door && !door.some((d) => inside(d.x, d.y) && reached[at(d.x, d.y)])) {
      issues.push({
        level: 'error',
        message: "The Furniture Shop's door can't be reached.",
        at: door[0],
      });
    }
  }
  if (!town.layout.pieces.some((p) => p.prefab === 'shop')) {
    issues.push({
      level: 'error',
      message: 'Place the Furniture Shop (Buildings): players buy furniture there.',
    });
  }
  if (deskCount === 0) issues.push({ level: 'warning', message: 'There are no study tables yet.' });

  // 4. The tileset.
  const rows = Math.max(1, Math.ceil(tileSources.length / COLS));
  const [tiles, tilesCtx] = canvas(COLS * T, rows * T);
  tileSources.forEach((s, i) =>
    tilesCtx.drawImage(atlasCanvas, s.x, s.y, T, T, (i % COLS) * T, Math.floor(i / COLS) * T, T, T),
  );
  const tileset = tiles.toDataURL('image/png');

  // 5. Trees and animations: always every one in the kit.
  const treePrefabs = [
    ...new Map(kit.prefabs.filter((p) => p.tree).map((p) => [p.tree!.name, p])).values(),
  ];
  const [treeCanvas, treeCtx] = canvas(
    treePrefabs.reduce((s, p) => s + p.frame.w, 0),
    Math.max(...treePrefabs.map((p) => p.frame.h)),
  );
  const treeFrames: Record<string, AtlasFrame> = {};
  let tx = 0;
  for (const p of treePrefabs) {
    treeCtx.drawImage(
      atlasCanvas,
      p.frame.x,
      p.frame.y,
      p.frame.w,
      p.frame.h,
      tx,
      0,
      p.frame.w,
      p.frame.h,
    );
    treeFrames[p.tree!.name] = atlasFrame(tx, 0, p.frame.w, p.frame.h);
    tx += p.frame.w;
  }
  const animPrefabs = kit.prefabs.filter((p) => p.anim);
  const strips: Frame[] = animPrefabs.map((p) => p.anim!.strip);
  const [animCanvas, animCtx] = canvas(
    Math.max(...strips.map((s) => s.w)),
    strips.reduce((s, f) => s + f.h, 0),
  );
  const animFrames: Record<string, AtlasFrame> = {};
  let ay = 0;
  for (const p of animPrefabs) {
    const s = p.anim!.strip;
    animCtx.drawImage(atlasCanvas, s.x, s.y, s.w, s.h, 0, ay, s.w, s.h);
    for (let i = 0; i < p.anim!.frames; i++) {
      animFrames[`${p.anim!.name}:${i}`] = atlasFrame(i * p.w * T, ay, p.w * T, p.h * T);
    }
    ay += s.h;
  }
  const atlasJson = (frames: Record<string, AtlasFrame>, image: string, c: HTMLCanvasElement) =>
    JSON.stringify(
      { frames, meta: { image, size: { w: c.width, h: c.height }, scale: '1' } },
      null,
      1,
    );

  // 6. The map itself.
  const COLL = tileSources.length + 1;
  const tileLayers = [
    ...TILE_LAYERS.map((name) => ({ name, data: layers[name], visible: true })),
    { name: 'collision', data: Array.from(solid, (s) => (s ? COLL : 0)), visible: false },
  ];
  const version = hashText(tileset.slice(-64) + tileSources.length + JSON.stringify(town.layout));
  const map: TiledMap = {
    compressionlevel: -1,
    width: W,
    height: H,
    tilewidth: T,
    tileheight: T,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    type: 'map',
    version: '1.10',
    nextlayerid: tileLayers.length + 2,
    nextobjectid: objects.length + 1,
    // The game adds this to the tileset and atlas URLs so browsers don't show stale art.
    properties: [{ name: 'version', type: 'string', value: version }],
    layers: [
      ...tileLayers.map((l, i) => ({
        id: i + 1,
        name: l.name,
        type: 'tilelayer' as const,
        width: W,
        height: H,
        x: 0,
        y: 0,
        opacity: 1,
        visible: l.visible,
        data: l.data,
      })),
      {
        id: tileLayers.length + 1,
        name: 'objects',
        type: 'objectgroup' as const,
        draworder: 'topdown',
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        objects,
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'town',
        image: '../tilesets/town.png',
        imagewidth: tiles.width,
        imageheight: tiles.height,
        columns: COLS,
        tilecount: tileSources.length,
        tilewidth: T,
        tileheight: T,
        margin: 0,
        spacing: 0,
      },
      {
        firstgid: COLL,
        name: 'collision',
        image: '../tilesets/collision.png',
        imagewidth: T,
        imageheight: T,
        columns: 1,
        tilecount: 1,
        tilewidth: T,
        tileheight: T,
        margin: 0,
        spacing: 0,
      },
    ],
  };

  // 7. The world-map picture: the town at 4 px a tile.
  const [full, fullCtx] = canvas(W * T, H * T);
  fullCtx.fillStyle = '#000';
  fullCtx.fillRect(0, 0, full.width, full.height);
  for (const name of TILE_LAYERS) {
    layers[name].forEach((gid, i) => {
      if (!gid) return;
      const s = tileSources[gid - 1]!;
      fullCtx.drawImage(atlasCanvas, s.x, s.y, T, T, (i % W) * T, Math.floor(i / W) * T, T, T);
    });
    if (name === 'below2') {
      for (const p of ordered) {
        const f = town.prefabOf(p);
        if (f.kind === 'tree' || f.kind === 'anim') {
          fullCtx.drawImage(
            atlasCanvas,
            f.frame.x,
            f.frame.y,
            f.frame.w,
            f.frame.h,
            p.x * T,
            p.y * T,
            f.frame.w,
            f.frame.h,
          );
        }
      }
    }
  }
  const [small, smallCtx] = canvas(W * 4, H * 4);
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(full, 0, 0, small.width, small.height);

  return {
    map,
    tmx: toTmx(map),
    tileset,
    trees: {
      png: treeCanvas.toDataURL('image/png'),
      json: atlasJson(treeFrames, 'town-trees.png', treeCanvas),
    },
    anims: {
      png: animCanvas.toDataURL('image/png'),
      json: atlasJson(animFrames, 'town-anims.png', animCanvas),
    },
    picture: small.toDataURL('image/png'),
    issues,
  };
}
