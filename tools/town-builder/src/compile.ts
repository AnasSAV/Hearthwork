import { groundFrames } from './ground';
import { T, type Kit, type Prefab } from './kit';
import { GROUND, isWet, type Piece, type Town } from './layout';
import type { MapId } from './maps';
import { toTmx, type TiledMap, type TiledObject } from './tmx';

/**
 * Turn a layout into what the game loads, in the same shape the generators write.
 *
 * The town (tools/art/build_town.py):
 *   maps/town.json + town.tmx   tile layers, hidden collision layer, objects
 *   tilesets/town.png           every tile used, deduplicated
 *   sprites/town-trees.*        every tree in the kit (the world map draws some of them too)
 *   sprites/town-anims.*        every animation in the kit, frames "<name>:<i>"
 *   sprites/town-map.png        a small picture of the town for the world map
 *
 * A mini-game map (tools/art/build_games.py):
 *   maps/<id>.json + .tmx       the same layers; the rapids add a hidden `raft` layer
 *   tilesets/<id>.png           its own tileset
 *   sprites/games.*             every animation in the kit plus the games' own sprites (shared)
 * with what the games read worked out here: fishing spots along every bank, the dig zone over
 * the sand, where a raft can float, the raft's start, the finish and the bonus buoys.
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
  /** Path under client/public/assets → file contents (text, or a PNG data URL). */
  files: Record<string, string>;
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

/** A short content hash, so the game can tell new art from a cached old copy. */
function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

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

const atlasJson = (frames: Record<string, AtlasFrame>, image: string, c: HTMLCanvasElement) =>
  JSON.stringify(
    { frames, meta: { image, size: { w: c.width, h: c.height }, scale: '1' } },
    null,
    1,
  );

/** Tiles and places that can be reached on foot (or by raft) from a start tile. */
function flood(W: number, H: number, blocked: Uint8Array, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(W * H);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || blocked[sy * W + sx]) return seen;
  const queue = [sy * W + sx];
  seen[sy * W + sx] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked[n] || seen[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

export function compile(town: Town, kit: Kit, art: HTMLImageElement, mapId: MapId): Compiled {
  const isTown = mapId === 'town';
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
  const ground = (x: number, y: number) => town.groundAt(x, y);

  // 1. Ground.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = groundFrames(kit, town, x, y);
      layers.ground[at(x, y)] = gidOf(f.ground.x, f.ground.y);
      if (f.path) layers.paths[at(x, y)] = gidOf(f.path.x, f.path.y);
      if (f.top) layers.decor[at(x, y)] = gidOf(f.top.x, f.top.y);
      if (isWet(ground(x, y))) solid[at(x, y)] = 1;
    }
  }

  // 2. Pieces, back to front, so overlapping pictures stack the way they look in the builder.
  const objects: TiledObject[] = [];
  const object = (o: Omit<TiledObject, 'id' | 'rotation' | 'visible'>) =>
    objects.push({ id: objects.length + 1, rotation: 0, visible: true, ...o });
  const ordered = [...town.layout.pieces].sort(
    (a, b) => a.y + town.prefabOf(a).h - (b.y + town.prefabOf(b).h) || a.x - b.x,
  );
  const issues: Issue[] = [];
  const seats: { x: number; y: number; name: string }[] = [];
  let deskCount = 0;
  let spawn: Piece | null = null;
  let launch: Piece | null = null;
  let finish: Piece | null = null;
  let shopDoor: { x: number; y: number }[] | null = null;
  const raftBlocked = new Set<number>();

  function stampTiles(f: Prefab, p: Piece, above: number): void {
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
        const pair: TileLayer[] = r < above ? ['above', 'above2'] : ['below', 'below2'];
        const free = pair.find((n) => !layers[n][at(x, y)]);
        layers[free ?? pair[1]!][at(x, y)] = gid;
      }
    }
  }

  for (const p of ordered) {
    const f = town.prefabOf(p);
    for (const [c, r] of f.solid) {
      if (!inside(p.x + c, p.y + r)) continue;
      solid[at(p.x + c, p.y + r)] = 1;
      raftBlocked.add(at(p.x + c, p.y + r));
    }
    switch (f.kind) {
      case 'tree':
        if (isTown) {
          // The town draws trees as swaying sprites.
          object({
            name: f.tree!.name,
            type: 'tree',
            x: p.x * T,
            y: p.y * T,
            width: f.w * T,
            height: f.h * T,
            properties: [prop('trunk', f.tree!.trunk)],
          });
        } else {
          // Game maps draw them as tiles: the canopy over players, the trunk under.
          stampTiles(f, p, f.h - f.tree!.trunk);
        }
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
      case 'marker':
        if (f.role === 'launch') launch = p;
        if (f.role === 'finish') finish = p;
        if (f.role === 'label' && p.label) {
          object({
            name: p.label,
            type: 'label',
            x: p.x * T + T / 2,
            y: p.y * T + T,
            width: 0,
            height: 0,
          });
        }
        if (f.role === 'buoy') {
          // GameScene draws the buoy with its feet at this point.
          object({
            name: `buoy-${p.uid}`,
            type: 'buoy',
            x: p.x * T + T,
            y: p.y * T + T + T / 2,
            width: 0,
            height: 0,
            point: true,
          });
        }
        break;
      default:
        stampTiles(f, p, f.above);
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
    const check = town.check(f, p.x, p.y, p);
    if (!check.ok) {
      issues.push({
        level: 'warning',
        message: `${f.name}: ${check.reason}`,
        at: { x: p.x, y: p.y },
      });
    }
  }

  // 3. The arrival point, and what can be reached from it on foot.
  const spawnPiece = spawn as Piece | null;
  let reached: Uint8Array = new Uint8Array(W * H);
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
    reached = flood(W, H, solid, spawnPiece.x, spawnPiece.y);
  }
  const canReach = (x: number, y: number) => inside(x, y) && reached[at(x, y)] === 1;

  // 4. What each map's game needs.
  let raftLayer: number[] | null = null;
  if (isTown) {
    const unreachable = seats.filter((s) => !canReach(s.x, s.y));
    if (spawnPiece && unreachable.length) {
      issues.push({
        level: 'warning',
        message: `${unreachable.length} ${unreachable.length === 1 ? 'seat' : 'seats'} can't be reached from the arrival point.`,
        at: unreachable[0],
      });
    }
    const door = shopDoor as { x: number; y: number }[] | null;
    if (!town.layout.pieces.some((p) => p.prefab === 'shop')) {
      issues.push({
        level: 'error',
        message: 'Place the Furniture Shop (Buildings): players buy furniture there.',
      });
    } else if (spawnPiece && door && !door.some((d) => canReach(d.x, d.y))) {
      issues.push({
        level: 'error',
        message: "The Furniture Shop's door can't be reached.",
        at: door[0],
      });
    }
    if (deskCount === 0)
      issues.push({ level: 'warning', message: 'There are no study tables yet.' });
  }

  if (mapId === 'lake') {
    // Anyone standing next to the water (a bank or a pier edge) can fish: one zone per run of
    // such tiles along a row.
    let spots = 0;
    let reachable = 0;
    for (let y = 0; y < H; y++) {
      let runStart = -1;
      for (let x = 0; x <= W; x++) {
        const spot =
          x < W &&
          !solid[at(x, y)] &&
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => inside(x + dx!, y + dy!) && isWet(ground(x + dx!, y + dy!)));
        if (spot) {
          spots++;
          if (canReach(x, y)) reachable++;
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          object({
            name: `fishing-${runStart}-${y}`,
            type: 'fish_zone',
            x: runStart * T,
            y: y * T,
            width: (x - runStart) * T,
            height: T,
          });
          runStart = -1;
        }
      }
    }
    if (!spots) issues.push({ level: 'error', message: 'There is no water to fish in.' });
    else if (spawnPiece && !reachable) {
      issues.push({
        level: 'error',
        message: "Nobody can walk to the water's edge from the arrival point.",
      });
    }
  }

  if (mapId === 'rapids') {
    // A raft floats on water away from the very edge of it (the bank art covers most of an edge
    // tile), and not through anything solid.
    const raft = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const water = (cx: number, cy: number) => inside(cx, cy) && ground(cx, cy) === GROUND.water;
        const open =
          water(x, y) &&
          water(x - 1, y) &&
          water(x + 1, y) &&
          water(x, y - 1) &&
          water(x, y + 1) &&
          !raftBlocked.has(at(x, y));
        raft[at(x, y)] = open ? 0 : 1;
      }
    }
    raftLayer = Array.from(raft);
    const launchPiece = launch as Piece | null;
    const finishPiece = finish as Piece | null;
    if (!launchPiece) {
      issues.push({ level: 'error', message: 'Place the Raft launch (Special) beside the river.' });
    }
    if (!finishPiece) {
      issues.push({ level: 'error', message: 'Place the Finish line (Special) downriver.' });
    }
    if (launchPiece) {
      const f = town.prefabOf(launchPiece);
      // The raft goes in at the open water nearest the launch.
      const cx = launchPiece.x + f.w / 2;
      const cy = launchPiece.y + f.h / 2;
      let start: { x: number; y: number } | null = null;
      let best = Infinity;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (raft[at(x, y)]) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d < best) {
            best = d;
            start = { x, y };
          }
        }
      }
      if (!start || best > 8) {
        issues.push({
          level: 'error',
          message: 'The Raft launch needs open water close by (within 8 tiles).',
          at: launchPiece,
        });
      } else {
        object({
          name: 'launch',
          type: 'launch',
          x: launchPiece.x * T,
          y: launchPiece.y * T,
          width: f.w * T,
          height: f.h * T,
          properties: [prop('startX', start.x * T + T / 2), prop('startY', start.y * T + T - 1)],
        });
        if (spawnPiece) {
          let onFoot = false;
          for (let y = launchPiece.y; y < launchPiece.y + f.h; y++)
            for (let x = launchPiece.x; x < launchPiece.x + f.w; x++)
              if (canReach(x, y)) onFoot = true;
          if (!onFoot) {
            issues.push({
              level: 'error',
              message: "The Raft launch can't be reached on foot.",
              at: launchPiece,
            });
          }
        }
        if (finishPiece) {
          const floated = flood(W, H, raft, start.x, start.y);
          let arrives = false;
          for (let y = finishPiece.y; y < Math.min(H, finishPiece.y + 3); y++)
            for (let x = 0; x < W; x++) if (floated[at(x, y)]) arrives = true;
          if (!arrives) {
            issues.push({
              level: 'warning',
              message: "A raft can't get from the launch to the finish line: the river is blocked.",
              at: finishPiece,
            });
          }
        }
      }
    }
    if (finishPiece) {
      object({
        name: 'finish',
        type: 'finish',
        x: 0,
        y: finishPiece.y * T,
        width: W * T,
        height: 3 * T,
      });
    }
  }

  if (mapId === 'meadow' && !town.layout.pieces.some((p) => town.prefabOf(p).flowers)) {
    issues.push({
      level: 'warning',
      message: 'Butterflies need flower beds (Nature) to gather at.',
    });
  }

  if (mapId === 'cove') {
    // Treasure is buried somewhere on the sand a player can stand on.
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (ground(x, y) !== GROUND.sand || solid[at(x, y)] || (spawnPiece && !canReach(x, y)))
          continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) issues.push({ level: 'error', message: 'Paint some sand to dig in (Ground).' });
    else {
      object({
        name: 'dig',
        type: 'dig_zone',
        x: x0 * T,
        y: y0 * T,
        width: (x1 - x0 + 1) * T,
        height: (y1 - y0 + 1) * T,
      });
    }
  }

  // 5. The tileset.
  const rows = Math.max(1, Math.ceil(tileSources.length / COLS));
  const [tiles, tilesCtx] = canvas(COLS * T, rows * T);
  tileSources.forEach((s, i) =>
    tilesCtx.drawImage(atlasCanvas, s.x, s.y, T, T, (i % COLS) * T, Math.floor(i / COLS) * T, T, T),
  );
  const tileset = tiles.toDataURL('image/png');

  // 6. The map itself.
  const COLL = tileSources.length + 1;
  const tileLayers = [
    ...TILE_LAYERS.map((name) => ({ name, data: layers[name], visible: true })),
    { name: 'collision', data: Array.from(solid, (s) => (s ? COLL : 0)), visible: false },
    ...(raftLayer
      ? [{ name: 'raft', data: raftLayer.map((s) => (s ? COLL : 0)), visible: false }]
      : []),
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
        name: isTown ? 'town' : 'games',
        image: `../tilesets/${mapId}.png`,
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

  const files: Record<string, string> = {
    [`maps/${mapId}.json`]: JSON.stringify(map),
    [`maps/${mapId}.tmx`]: toTmx(map),
    [`tilesets/${mapId}.png`]: tileset,
  };

  // 7. Animations (and trees, for the town): always every one in the kit.
  const animPrefabs = kit.prefabs.filter((p) => p.anim);
  const extras = isTown ? [] : Object.entries(kit.sprites);
  const stripW = Math.max(...animPrefabs.map((p) => p.anim!.strip.w), 1);
  const [animCanvas, animCtx] = canvas(
    Math.max(
      stripW,
      extras.reduce((s, [, f]) => s + f.w, 0),
    ),
    animPrefabs.reduce((s, p) => s + p.anim!.strip.h, 0) +
      Math.max(0, ...extras.map(([, f]) => f.h)),
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
  let ex = 0;
  for (const [name, f] of extras) {
    animCtx.drawImage(atlasCanvas, f.x, f.y, f.w, f.h, ex, ay, f.w, f.h);
    animFrames[name] = atlasFrame(ex, ay, f.w, f.h);
    ex += f.w;
  }
  const sheetName = isTown ? 'town-anims' : 'games';
  files[`sprites/${sheetName}.png`] = animCanvas.toDataURL('image/png');
  files[`sprites/${sheetName}.json`] = atlasJson(animFrames, `${sheetName}.png`, animCanvas);

  if (isTown) {
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
    files['sprites/town-trees.png'] = treeCanvas.toDataURL('image/png');
    files['sprites/town-trees.json'] = atlasJson(treeFrames, 'town-trees.png', treeCanvas);

    // The world-map picture: the town at 4 px a tile.
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
    files['sprites/town-map.png'] = small.toDataURL('image/png');
  }

  return { files, issues };
}
