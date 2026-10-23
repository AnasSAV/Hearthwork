/**
 * Bootstrap generator for the town map. Writes client/public/assets/maps/town.json (loaded
 * by Phaser and the server) and town.tmx (open/edit in Tiled).
 *
 * After the first hand edit in Tiled, treat the .tmx as the source of truth and export the
 * .json from Tiled (File → Export As → JSON, "Embed tilesets" on). Re-running this script
 * overwrites both files.
 *
 * Run: npx tsx tools/maps/build-town.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = 48;
const H = 36;
const T = 16;

// Tilesets: gid = firstgid + local index.
const TINY = 1; // Kenney Tiny Town, 12 cols × 11 rows
const INDOOR = 133; // Kenney Roguelike Indoors, 27 cols × 18 rows
const COLL = 619; // single collision marker tile
const tilesets = [
  {
    firstgid: TINY,
    name: 'tinytown',
    image: '../tilesets/tinytown.png',
    cols: 12,
    w: 192,
    h: 176,
    count: 132,
  },
  {
    firstgid: INDOOR,
    name: 'indoor',
    image: '../tilesets/indoor.png',
    cols: 27,
    w: 432,
    h: 288,
    count: 486,
  },
  {
    firstgid: COLL,
    name: 'collision',
    image: '../tilesets/collision.png',
    cols: 1,
    w: 16,
    h: 16,
    count: 1,
  },
];

const tiny = (i: number) => TINY + i;
const indoor = (i: number) => INDOOR + i;

// --- deterministic RNG so the map is stable between runs ---
let seed = 1337;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

type Grid = number[];
const grid = (): Grid => new Array<number>(W * H).fill(0);
const ground = grid();
const decor = grid();
const buildings = grid();
const collision = grid();
/** Tiles that must stay clear of random trees (paths, plaza, lots, doorsteps…). */
const reserved = new Uint8Array(W * H);

const idx = (x: number, y: number) => y * W + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

function put(layer: Grid, x: number, y: number, gid: number, solid = false) {
  if (!inside(x, y)) return;
  layer[idx(x, y)] = gid;
  reserved[idx(x, y)] = 1;
  if (solid) collision[idx(x, y)] = COLL;
}

function reserve(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
}

/** Dirt area with grass edges (Tiny Town 9-slice 12-14 / 24-26 / 36-38). */
function dirt(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const col = x === x0 ? 0 : x === x1 ? 2 : 1;
      const row = y === y0 ? 0 : y === y1 ? 2 : 1;
      put(ground, x, y, tiny(12 + row * 12 + col));
    }
  }
}

/** Cobblestone path (tile 43). */
function path(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(ground, x, y, tiny(43));
}

// --- objects layer ---
interface Prop {
  name: string;
  type: string;
  value: string | number | boolean;
}
interface Obj {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: Prop[];
}
const objects: Obj[] = [];
let nextObjectId = 1;
function addObject(o: Omit<Obj, 'id'>) {
  objects.push({ id: nextObjectId++, ...o });
}
const prop = (name: string, value: string | number | boolean): Prop => ({
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

// ------------------------------------------------------------------
// 1. Grass everywhere, with a sprinkle of tufts and flowers.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const r = rand();
    ground[idx(x, y)] = r < 0.08 ? tiny(1) : r < 0.12 ? tiny(2) : tiny(0);
  }
}

// 2. Paths and the central study plaza.
const PLAZA = { x0: 15, y0: 10, x1: 32, y1: 23 };
dirt(PLAZA.x0, PLAZA.y0, PLAZA.x1, PLAZA.y1);
path(23, 2, 24, PLAZA.y0 - 1); // north road
path(23, PLAZA.y1 + 1, 24, 32); // south road to the lots
path(2, 16, PLAZA.x0 - 1, 17); // west road
path(PLAZA.x1 + 1, 16, 45, 17); // east road
path(6, 7, 6, 15); // shop path
path(41, 7, 41, 15); // library path
path(2, 31, 45, 32); // lots street

// 3. Buildings (roof row, roof row with gable, wall row with door).
function building(name: string, x: number, y: number, style: 'red' | 'blue', label: string): void {
  const width = 5;
  const doorCol = 2;
  const roofTop = style === 'red' ? [52, 53, 54] : [48, 49, 50];
  const roofLow = style === 'red' ? [64, 65, 66] : [60, 61, 62];
  const gable = style === 'red' ? 67 : 63;
  const wall =
    style === 'red' ? { l: 76, r: 79, win: 88, door: 89 } : { l: 72, r: 75, win: 84, door: 85 };
  for (let c = 0; c < width; c++) {
    const edge = c === 0 ? 0 : c === width - 1 ? 2 : 1;
    put(buildings, x + c, y, tiny(roofTop[edge]!), true);
    put(buildings, x + c, y + 1, tiny(c === doorCol ? gable : roofLow[edge]!), true);
    const w = c === 0 ? wall.l : c === width - 1 ? wall.r : c === doorCol ? wall.door : wall.win;
    put(buildings, x + c, y + 2, tiny(w), true);
  }
  reserve(x - 1, y - 1, x + width, y + 3);
  addObject({
    name,
    type: 'building',
    x: x * T,
    y: y * T,
    width: width * T,
    height: 3 * T,
    properties: [
      prop('label', label),
      prop('doorX', (x + doorCol) * T + T / 2),
      prop('doorY', (y + 3) * T),
    ],
  });
}
building('shop', 4, 4, 'red', 'Furniture Shop');
building('library', 39, 4, 'blue', 'Library');
put(buildings, 8, 7, tiny(83), true); // shop sign
put(buildings, 43, 7, tiny(83), true); // library sign
put(buildings, 22, 9, tiny(83), true); // plaza sign

// 4. Study plaza furniture. Desks/tables are solid; chairs are walkable seats.
let deskCount = 0;
function seat(x: number, y: number, chair: number, facing: string, table?: string) {
  put(buildings, x, y, indoor(chair));
  deskCount++;
  addObject({
    name: `desk-${deskCount}`,
    type: 'desk',
    x: x * T,
    y: y * T,
    width: T,
    height: T,
    properties: [prop('facing', facing), ...(table ? [prop('table', table)] : [])],
  });
}

/** 3×2 group table with three chairs above and three below. */
function groupTable(name: string, x: number, y: number) {
  const top = [0, 1, 2];
  const bottom = [27, 28, 29];
  for (let c = 0; c < 3; c++) {
    put(buildings, x + c, y, indoor(top[c]!), true);
    put(buildings, x + c, y + 1, indoor(bottom[c]!), true);
    seat(x + c, y - 1, 54, 'down', name);
    seat(x + c, y + 2, 55, 'up', name);
  }
}
groupTable('table-west', 18, 13);
groupTable('table-east', 27, 13);

/** Solo desk with its chair below (player faces up at the desk). */
function soloDesk(x: number, y: number) {
  put(buildings, x, y, indoor(85), true);
  seat(x, y + 1, 55, 'up');
}
for (const x of [17, 19, 21, 26, 28, 30]) soloDesk(x, 19);

// Potted plants at the plaza corners (solid).
for (const [x, y] of [
  [PLAZA.x0 + 1, PLAZA.y0 + 1],
  [PLAZA.x1 - 1, PLAZA.y0 + 1],
  [PLAZA.x0 + 1, PLAZA.y1 - 1],
  [PLAZA.x1 - 1, PLAZA.y1 - 1],
] as const) {
  put(buildings, x, y, indoor(16), true);
}

// 5. House lots (Phase 4 puts house exteriors here). Dirt patch + sign, door faces the street.
const LOT_XS = [3, 9, 15, 28, 34, 40];
// The whole lot is solid: the client draws the owner's house (or a "for sale" sign) on top.
LOT_XS.forEach((x, i) => {
  dirt(x, 28, x + 4, 30);
  for (let ty = 28; ty <= 30; ty++)
    for (let tx = x; tx <= x + 4; tx++) collision[idx(tx, ty)] = COLL;
  reserve(x - 1, 27, x + 5, 30);
  addObject({
    name: `plot-${i}`,
    type: 'plot',
    x: x * T,
    y: 28 * T,
    width: 5 * T,
    height: 3 * T,
    // The door is the bottom-centre tile; doorY is the top edge of the doorstep below it.
    properties: [prop('plotIndex', i), prop('doorX', (x + 2) * T + T / 2), prop('doorY', 31 * T)],
  });
});

// 6. Fences for a bit of structure.
function fenceRow(x0: number, x1: number, y: number) {
  for (let x = x0; x <= x1; x++) {
    const t = x === x0 ? 44 : x === x1 ? 46 : 45;
    put(buildings, x, y, tiny(t), true);
  }
}
fenceRow(10, 14, 12);
fenceRow(33, 37, 12);
fenceRow(10, 14, 21);
fenceRow(33, 37, 21);

// 7. Border forest (2 tiles thick), leaving the map edge closed.
const TREE_TILES = [16, 28, 5, 27, 15, 3];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
    if (!border) continue;
    const r = rand();
    put(
      buildings,
      x,
      y,
      tiny(
        r < 0.75 ? TREE_TILES[Math.floor(r * 4) % 3]! : TREE_TILES[3 + (Math.floor(r * 10) % 3)]!,
      ),
      true,
    );
  }
}

// 8. Scattered trees and bushes in the free grass.
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    if (reserved[idx(x, y)]) continue;
    // Keep a one-tile margin around anything reserved so walkways stay open.
    let nearReserved = false;
    for (let dy = -1; dy <= 1 && !nearReserved; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (inside(x + dx, y + dy) && reserved[idx(x + dx, y + dy)]) nearReserved = true;
    if (nearReserved) continue;
    const r = rand();
    if (r < 0.07)
      put(buildings, x, y, tiny(TREE_TILES[Math.floor(rand() * TREE_TILES.length)]!), true);
    // Mushrooms and sprouts read as obstacles, so they're solid too.
    else if (r < 0.09) put(buildings, x, y, tiny(29), true);
    else if (r < 0.11) put(buildings, x, y, tiny(17), true);
  }
}

// 9. Spawn on the south road just below the plaza.
addObject({
  name: 'spawn',
  type: 'spawn',
  x: 24 * T,
  y: (PLAZA.y1 + 2) * T + T - 1,
  width: 0,
  height: 0,
  point: true,
});

// ------------------------------------------------------------------
// Output
const layers = [
  { name: 'ground', data: ground, visible: true },
  { name: 'decor', data: decor, visible: true },
  { name: 'buildings', data: buildings, visible: true },
  { name: 'collision', data: collision, visible: false },
];

const json = {
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
  nextlayerid: layers.length + 2,
  nextobjectid: nextObjectId,
  layers: [
    ...layers.map((l, i) => ({
      id: i + 1,
      name: l.name,
      type: 'tilelayer',
      width: W,
      height: H,
      x: 0,
      y: 0,
      opacity: 1,
      visible: l.visible,
      data: l.data,
    })),
    {
      id: layers.length + 1,
      name: 'objects',
      type: 'objectgroup',
      draworder: 'topdown',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      objects: objects.map((o) => ({ rotation: 0, visible: true, ...o })),
    },
  ],
  tilesets: tilesets.map((t) => ({
    firstgid: t.firstgid,
    name: t.name,
    image: t.image,
    imagewidth: t.w,
    imageheight: t.h,
    columns: t.cols,
    tilecount: t.count,
    tilewidth: T,
    tileheight: T,
    margin: 0,
    spacing: 0,
  })),
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const csv = (data: number[]) => {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) rows.push(data.slice(y * W, (y + 1) * W).join(','));
  return rows.join(',\n');
};
const tmx = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="${W}" height="${H}" tilewidth="${T}" tileheight="${T}" infinite="0" nextlayerid="${json.nextlayerid}" nextobjectid="${nextObjectId}">`,
  ...tilesets.map(
    (t) =>
      ` <tileset firstgid="${t.firstgid}" name="${t.name}" tilewidth="${T}" tileheight="${T}" tilecount="${t.count}" columns="${t.cols}">\n  <image source="${t.image}" width="${t.w}" height="${t.h}"/>\n </tileset>`,
  ),
  ...layers.map(
    (l, i) =>
      ` <layer id="${i + 1}" name="${l.name}" width="${W}" height="${H}"${l.visible ? '' : ' visible="0"'}>\n  <data encoding="csv">\n${csv(l.data)}\n</data>\n </layer>`,
  ),
  ` <objectgroup id="${layers.length + 1}" name="objects">`,
  ...objects.map((o) => {
    const size = o.point ? '' : ` width="${o.width}" height="${o.height}"`;
    const props = o.properties?.length
      ? `\n   <properties>\n${o.properties.map((p) => `    <property name="${esc(p.name)}"${p.type === 'string' ? '' : ` type="${p.type}"`} value="${esc(String(p.value))}"/>`).join('\n')}\n   </properties>\n  `
      : '';
    const inner = o.point ? `${props ? props.trimEnd() + '\n   ' : '\n   '}<point/>\n  ` : props;
    return `  <object id="${o.id}" name="${esc(o.name)}" type="${o.type}" x="${o.x}" y="${o.y}"${size}${inner ? `>${inner}</object>` : '/>'}`;
  }),
  ' </objectgroup>',
  '</map>',
  '',
].join('\n');

const outDir = fileURLToPath(new URL('../../client/public/assets/maps/', import.meta.url));
writeFileSync(outDir + 'town.json', JSON.stringify(json));
writeFileSync(outDir + 'town.tmx', tmx);
console.log(
  `Wrote town.json and town.tmx (${W}×${H}, ${objects.length} objects, ${deskCount} desks)`,
);
