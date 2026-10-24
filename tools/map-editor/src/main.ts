import {
  ALL_LAYERS,
  T,
  TILE_LAYERS,
  TownDoc,
  getProp,
  setProp,
  shiftObject,
  type Issue,
  type LayerName,
  type MapObject,
  type Rect,
  type Stamp,
  type TileLayer,
  type TiledMap,
} from './model';
import { animNames, drawMap, loadImage, loadSheet, thumbnail, type Art } from './render';
import { toTmx } from './tmx';

// ---------- State ----------

type Tool = 'select' | 'brush' | 'erase' | 'rect' | 'collision' | 'objects';
const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    hint: 'Drag a box, then drag it to move that part of the town',
  },
  { id: 'brush', label: 'Brush', key: 'B', hint: 'Paint the picked tiles on the active layer' },
  {
    id: 'erase',
    label: 'Erase',
    key: 'E',
    hint: 'Erase on the active layer (Shift: every layer but ground)',
  },
  { id: 'rect', label: 'Fill', key: 'R', hint: 'Drag a box to fill it with the picked tiles' },
  { id: 'collision', label: 'Walls', key: 'C', hint: 'Left: solid, right: walkable' },
  {
    id: 'objects',
    label: 'Objects',
    key: 'O',
    hint: 'Pick, drag and edit desks, trees, buildings…',
  },
];
const LAYER_INFO: Record<TileLayer, string> = {
  ground: 'grass, water',
  paths: 'roads, plaza',
  decor: 'flowers, rugs',
  below: 'walls, furniture',
  below2: 'more below',
  above: 'roofs, canopies',
  above2: 'more above',
};

let doc!: TownDoc;
let art!: Art;
let tool: Tool = 'select';
let activeLayer: TileLayer = 'decor';
const hidden = new Set<TileLayer | 'objects'>();
let showGrid = true;
let showCollision = false;
let showBoxes = true;
let zoom = 2;
let panX = 0;
let panY = 0;
/** Picked tiles (one layer's worth; gids). */
let brush: Stamp = { w: 1, h: 1, layers: { decor: [1] }, objects: [] };
let palettePick: Rect = { x: 0, y: 0, w: 1, h: 1 };
let paletteZoom = 2;
let selection: Rect | null = null;
let clipboard: Stamp | null = null;
/** A stamp following the cursor: a paste, or a new object to place. */
let pasting: Stamp | null = null;
let placing: MapObject | null = null;
let selectedId: number | null = null;
let moveGround = false;
let moveObjects = true;
let pasteOverlay = false;
let issues: Issue[] = [];
let message = '';
let hover: { x: number; y: number } | null = null;
const undoStack: string[] = [];
const redoStack: string[] = [];
let savedSnapshot = '';

// ---------- DOM ----------

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const view = $<HTMLCanvasElement>('view');
const ctx = view.getContext('2d')!;
const stage = $('stage');
const palette = $<HTMLCanvasElement>('palette');
const pctx = palette.getContext('2d')!;
const inspector = $('inspector');
let base = document.createElement('canvas');
let baseDirty = true;
let drawQueued = false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

// ---------- Editing helpers ----------

function changed(opts: { base?: boolean; inspector?: boolean } = {}): void {
  if (opts.base !== false) baseDirty = true;
  if (opts.inspector !== false) renderInspector();
  updateSaveState();
  redraw();
}

function pushUndo(snapshot = doc.snapshot()): void {
  undoStack.push(snapshot);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
}

function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(doc.snapshot());
  doc.restore(s);
  afterRestore();
}

function redo(): void {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(doc.snapshot());
  doc.restore(s);
  afterRestore();
}

function afterRestore(): void {
  if (selectedId !== null && !doc.objects.some((o) => o.id === selectedId)) selectedId = null;
  if (selection && (selection.x + selection.w > doc.w || selection.y + selection.h > doc.h))
    selection = null;
  resizeBase();
  changed();
}

function resizeBase(): void {
  if (base.width !== doc.w * T || base.height !== doc.h * T) {
    base = document.createElement('canvas');
    base.width = doc.w * T;
    base.height = doc.h * T;
  }
}

function selectedObject(): MapObject | undefined {
  return selectedId === null ? undefined : doc.objects.find((o) => o.id === selectedId);
}

function layersToMove(): LayerName[] {
  return ALL_LAYERS.filter((l) => moveGround || l !== 'ground');
}

function say(text: string): void {
  message = text;
  redraw();
}

/** A stamp drawn as its own little map (for previews). */
function stampDoc(s: Stamp): TownDoc {
  const json = structuredClone({ ...doc.json, layers: [] }) as TiledMap;
  let id = 1;
  json.width = s.w;
  json.height = s.h;
  json.layers = [
    ...ALL_LAYERS.map((name) => ({
      id: id++,
      name,
      type: 'tilelayer' as const,
      width: s.w,
      height: s.h,
      visible: true,
      data: s.layers[name] ?? new Array<number>(s.w * s.h).fill(0),
    })),
    { id: id++, name: 'objects', type: 'objectgroup' as const, visible: true, objects: s.objects },
  ];
  return new TownDoc(json);
}

const previewCache = new WeakMap<Stamp, HTMLCanvasElement>();
function stampPreview(s: Stamp): HTMLCanvasElement {
  let c = previewCache.get(s);
  if (!c) {
    c = document.createElement('canvas');
    c.width = s.w * T;
    c.height = s.h * T;
    drawMap(c.getContext('2d')!, stampDoc(s), art, () => true);
    previewCache.set(s, c);
  }
  return c;
}

// ---------- Drawing ----------

function redraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const hgt = stage.clientHeight;
  if (view.width !== Math.round(w * dpr) || view.height !== Math.round(hgt * dpr)) {
    view.width = Math.round(w * dpr);
    view.height = Math.round(hgt * dpr);
  }
  if (baseDirty) {
    const b = base.getContext('2d')!;
    b.clearRect(0, 0, base.width, base.height);
    drawMap(b, doc, art, (l) => !hidden.has(l));
    baseDirty = false;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2a2420';
  ctx.fillRect(0, 0, w, hgt);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14110f';
  ctx.fillRect(0, 0, doc.w * T, doc.h * T);
  ctx.drawImage(base, 0, 0);
  const px = 1 / zoom;

  // Visible tile range, to keep overlays cheap.
  const x0 = Math.max(0, Math.floor(-panX / zoom / T));
  const y0 = Math.max(0, Math.floor(-panY / zoom / T));
  const x1 = Math.min(doc.w, Math.ceil((w - panX) / zoom / T));
  const y1 = Math.min(doc.h, Math.ceil((hgt - panY) / zoom / T));

  if (showCollision || tool === 'collision') {
    ctx.fillStyle = 'rgba(234, 60, 60, 0.38)';
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (doc.get('collision', x, y)) ctx.fillRect(x * T, y * T, T, T);
  }

  if (showGrid && zoom >= 1) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(x * T, y0 * T);
      ctx.lineTo(x * T, y1 * T);
    }
    for (let y = y0; y <= y1; y++) {
      ctx.moveTo(x0 * T, y * T);
      ctx.lineTo(x1 * T, y * T);
    }
    ctx.stroke();
  }

  if (showBoxes || tool === 'objects') drawObjectBoxes(px);

  if (selection) {
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(selection.x * T, selection.y * T, selection.w * T, selection.h * T);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4 * px;
    ctx.strokeRect(selection.x * T, selection.y * T, selection.w * T, selection.h * T);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(selection.x * T, selection.y * T, selection.w * T, selection.h * T);
  }

  if (hover) {
    const ghost = pasting ?? (tool === 'brush' && !drag ? brush : null);
    if (placing) {
      const o = placedAt(placing, hover.x, hover.y);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(o.x, o.y, o.width || T, o.height || T);
      drawPlacingSprite(o);
    } else if (ghost) {
      ctx.globalAlpha = 0.65;
      ctx.drawImage(stampPreview(ghost), hover.x * T, hover.y * T);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(hover.x * T, hover.y * T, ghost.w * T, ghost.h * T);
    } else if (tool !== 'select' && tool !== 'objects') {
      ctx.strokeStyle = tool === 'erase' ? '#ff9a8a' : '#ffe08a';
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(hover.x * T, hover.y * T, T, T);
    }
  }
  if (drag?.kind === 'rect' || drag?.kind === 'select') {
    const r = rectFrom(drag.start, drag.now);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(r.x * T, r.y * T, r.w * T, r.h * T);
  }

  // Status line.
  const st = $('status');
  st.replaceChildren(
    h('span', {}, `${doc.w} × ${doc.h} tiles`),
    hover ? h('span', {}, `x ${hover.x}, y ${hover.y}`) : '',
    hover
      ? h(
          'span',
          {},
          TILE_LAYERS.filter((l) => doc.get(l, hover!.x, hover!.y))
            .map((l) => `${l} ${doc.get(l, hover!.x, hover!.y)}`)
            .join(' · ') + (doc.get('collision', hover.x, hover.y) ? ' · solid' : ''),
        )
      : '',
    selection ? h('span', {}, `selection ${selection.w}×${selection.h}`) : '',
    h('span', { class: 'msg' }, message),
  );
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
}

function drawPlacingSprite(o: MapObject): void {
  const sheet = o.type === 'tree' ? art.trees : o.type === 'anim' ? art.anims : null;
  const f = sheet?.frames[o.type === 'tree' ? o.name : `${o.name}:0`];
  if (sheet && f) {
    ctx.globalAlpha = 0.75;
    ctx.drawImage(sheet.img, f.x, f.y, f.w, f.h, o.x, o.y, f.w, f.h);
    ctx.globalAlpha = 1;
  }
}

const BOX_COLOR: Record<string, string> = {
  desk: '#6aa8e2',
  building: '#f5b84e',
  flowers: '#f39bc3',
  anim: '#b49cf0',
  tree: 'rgba(160, 230, 160, 0.8)',
  spawn: '#79e08c',
};

function drawObjectBoxes(px: number): void {
  const sel = selectedObject();
  ctx.font = `bold ${10 * px * Math.min(2, zoom)}px Nunito, sans-serif`;
  for (const o of doc.objects) {
    if (o.type === 'tree' && tool !== 'objects' && o !== sel) continue;
    const color = BOX_COLOR[o.type] ?? '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = (o === sel ? 3 : 1.5) * px;
    if (o.point || o.type === 'spawn') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1b3d22';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText('spawn', o.x + 7, o.y + 3);
      continue;
    }
    if (o.type === 'desk') {
      ctx.fillStyle = 'rgba(106, 168, 226, 0.3)';
      ctx.fillRect(o.x, o.y, o.width, o.height);
      // An arrow for the way a seated player faces.
      const f = getProp<string>(o, 'facing') ?? 'up';
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      const [dx, dy] =
        f === 'up' ? [0, -1] : f === 'down' ? [0, 1] : f === 'left' ? [-1, 0] : [1, 0];
      ctx.beginPath();
      ctx.moveTo(cx - dx * 4, cy - dy * 4);
      ctx.lineTo(cx + dx * 6, cy + dy * 6);
      ctx.stroke();
    }
    if (o.type === 'building') {
      ctx.setLineDash([6 * px, 4 * px]);
      const dx = getProp<number>(o, 'doorX');
      const dy = getProp<number>(o, 'doorY');
      if (dx !== undefined && dy !== undefined) {
        ctx.fillStyle = color;
        ctx.fillRect(dx - 3, dy - 3, 6, 6);
      }
    }
    ctx.strokeRect(o.x, o.y, o.width, o.height);
    ctx.setLineDash([]);
    if (o.type === 'desk' || o.type === 'building' || o === sel) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3 * px;
      const label = o.type === 'building' ? (getProp<string>(o, 'label') ?? o.name) : o.name;
      ctx.strokeText(label, o.x + 1, o.y - 3 * px);
      ctx.fillText(label, o.x + 1, o.y - 3 * px);
    }
  }
}

// ---------- Palette ----------

function drawPalette(): void {
  const img = art.tiles;
  palette.width = img.width * paletteZoom;
  palette.height = img.height * paletteZoom;
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(img, 0, 0, palette.width, palette.height);
  const s = T * paletteZoom;
  pctx.strokeStyle = 'rgba(0,0,0,0.12)';
  pctx.lineWidth = 1;
  pctx.beginPath();
  for (let x = 0; x <= img.width / T; x++) {
    pctx.moveTo(x * s + 0.5, 0);
    pctx.lineTo(x * s + 0.5, palette.height);
  }
  for (let y = 0; y <= img.height / T; y++) {
    pctx.moveTo(0, y * s + 0.5);
    pctx.lineTo(palette.width, y * s + 0.5);
  }
  pctx.stroke();
  pctx.lineWidth = 3;
  pctx.strokeStyle = '#f5b84e';
  pctx.strokeRect(
    palettePick.x * s + 1.5,
    palettePick.y * s + 1.5,
    palettePick.w * s - 3,
    palettePick.h * s - 3,
  );
}

function pickFromPalette(r: Rect): void {
  palettePick = r;
  const cols = doc.tiles.columns;
  const cells: number[] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const t = (r.y + y) * cols + (r.x + x);
      cells.push(t < doc.tiles.tilecount ? doc.tiles.firstgid + t : 0);
    }
  brush = { w: r.w, h: r.h, layers: { [activeLayer]: cells }, objects: [] };
  drawPalette();
  if (tool !== 'brush' && tool !== 'rect') setTool('brush');
  redraw();
}

function paletteTile(e: MouseEvent): { x: number; y: number } {
  const r = palette.getBoundingClientRect();
  const s = T * paletteZoom;
  return {
    x: Math.max(0, Math.min(art.tiles.width / T - 1, Math.floor((e.clientX - r.left) / s))),
    y: Math.max(0, Math.min(art.tiles.height / T - 1, Math.floor((e.clientY - r.top) / s))),
  };
}

let paletteDrag: { x: number; y: number } | null = null;
palette.addEventListener('mousedown', (e) => {
  paletteDrag = paletteTile(e);
  pickFromPalette({ ...paletteDrag, w: 1, h: 1 });
});
window.addEventListener('mousemove', (e) => {
  if (!paletteDrag) return;
  const t = paletteTile(e);
  pickFromPalette(rectFrom(paletteDrag, t));
});
window.addEventListener('mouseup', () => (paletteDrag = null));
$('pal-zoom').addEventListener('click', () => {
  paletteZoom = paletteZoom === 2 ? 1 : paletteZoom === 1 ? 3 : 2;
  $('pal-zoom').textContent = `${paletteZoom}×`;
  drawPalette();
});

/** The brush keeps its tiles but paints on whichever layer is active. */
function brushOnActive(): Stamp {
  const cells = Object.values(brush.layers)[0] ?? [];
  return { w: brush.w, h: brush.h, layers: { [activeLayer]: cells }, objects: [] };
}

// ---------- Layers panel ----------

function renderLayers(): void {
  const rows = TILE_LAYERS.map((l) => {
    const eye = h('button', {
      class: `eye${hidden.has(l) ? ' off' : ''}`,
      title: 'Show / hide',
      textContent: '👁',
    });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hidden.has(l)) hidden.delete(l);
      else hidden.add(l);
      renderLayers();
      changed({ inspector: false });
    });
    const row = h(
      'div',
      { class: `layer-row${l === activeLayer ? ' active' : ''}` },
      eye,
      h('span', {}, l),
      h('small', {}, LAYER_INFO[l]),
    );
    row.addEventListener('click', () => {
      activeLayer = l;
      renderLayers();
      redraw();
    });
    return row;
  });
  const objEye = h('button', {
    class: `eye${hidden.has('objects') ? ' off' : ''}`,
    title: 'Show / hide',
    textContent: '👁',
  });
  objEye.addEventListener('click', () => {
    if (hidden.has('objects')) hidden.delete('objects');
    else hidden.add('objects');
    renderLayers();
    changed({ inspector: false });
  });
  rows.push(
    h(
      'div',
      { class: 'layer-row' },
      objEye,
      h('span', {}, 'trees & animations'),
      h('small', {}, 'objects'),
    ),
  );
  $('layers').replaceChildren(...rows);
}

// ---------- Tools ----------

function setTool(t: Tool): void {
  tool = t;
  pasting = null;
  placing = null;
  for (const b of $('tools').querySelectorAll('button'))
    b.classList.toggle('on', b.dataset.tool === t);
  stage.style.cursor = t === 'objects' ? 'default' : 'crosshair';
  renderInspector();
  redraw();
}

$('tools').replaceChildren(
  ...TOOLS.map((t) => {
    const b = h('button', { title: t.hint }, t.label, h('kbd', {}, t.key));
    b.dataset.tool = t.id;
    b.addEventListener('click', () => setTool(t.id));
    return b;
  }),
);

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

function inRect(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

// ---------- Mouse on the map ----------

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'select'; start: { x: number; y: number }; now: { x: number; y: number } }
  | { kind: 'rect'; start: { x: number; y: number }; now: { x: number; y: number } }
  | { kind: 'move'; start: { x: number; y: number }; before: string; dx: number; dy: number }
  | {
      kind: 'paint';
      start: { x: number; y: number };
      last: string;
      erase?: boolean;
      solid?: boolean;
    }
  | {
      kind: 'object';
      id: number;
      start: { x: number; y: number };
      before: string;
      ox: number;
      oy: number;
      moved: boolean;
    };
let drag: Drag | null = null;
let spaceDown = false;

function mapPoint(e: MouseEvent): { x: number; y: number } {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left - panX) / zoom, y: (e.clientY - r.top - panY) / zoom };
}
function tileAt(e: MouseEvent): { x: number; y: number } {
  const p = mapPoint(e);
  return { x: Math.floor(p.x / T), y: Math.floor(p.y / T) };
}

/** Objects under a point, smallest first (so a desk wins over the tree behind it). */
function objectAt(p: { x: number; y: number }): MapObject | undefined {
  const hits = doc.objects.filter((o) =>
    o.point || o.type === 'spawn'
      ? Math.hypot(p.x - o.x, p.y - o.y) < 8
      : p.x >= o.x && p.y >= o.y && p.x < o.x + o.width && p.y < o.y + o.height,
  );
  return hits.sort(
    (a, b) => (a.point ? 0 : a.width * a.height) - (b.point ? 0 : b.width * b.height),
  )[0];
}

/** Where a new object lands for the hovered tile (trees: trunk base on that tile). */
function placedAt(o: MapObject, tx: number, ty: number): MapObject {
  const c = structuredClone(o);
  if (o.type === 'tree') {
    const w = Math.round(o.width / T);
    const hh = Math.round(o.height / T);
    c.x = (tx - (w >= 4 ? w / 2 - 1 : Math.floor(w / 2))) * T;
    c.y = (ty - hh + 1) * T;
  } else if (o.type === 'anim') {
    c.x = tx * T;
    c.y = (ty + 1) * T - o.height;
  } else if (o.type === 'spawn') {
    c.x = tx * T + T / 2;
    c.y = ty * T + T - 1;
  } else {
    c.x = tx * T;
    c.y = ty * T;
  }
  return c;
}

function paintAt(t: { x: number; y: number }, d: Extract<Drag, { kind: 'paint' }>): void {
  if (tool === 'collision') {
    doc.setSolid(t.x, t.y, !!d.solid);
  } else if (d.erase) {
    const layers: LayerName[] = d.solid ? TILE_LAYERS.filter((l) => l !== 'ground') : [activeLayer];
    for (const l of layers) doc.set(l, t.x, t.y, 0);
  } else {
    // Multi-tile brushes tile from where the stroke began.
    const b = brushOnActive();
    const ax = d.start.x + Math.floor((t.x - d.start.x) / b.w) * b.w;
    const ay = d.start.y + Math.floor((t.y - d.start.y) / b.h) * b.h;
    doc.writeTiles(b, ax, ay, true);
  }
}

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('mousedown', (e) => {
  const t = tileAt(e);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: panX, py: panY };
    stage.style.cursor = 'grabbing';
    return;
  }
  if (placing && e.button === 0) {
    pushUndo();
    const o = placedAt(placing, t.x, t.y);
    o.id = doc.newId();
    if (o.type === 'spawn') {
      const s = doc.objects.find((q) => q.type === 'spawn');
      if (s) {
        s.x = o.x;
        s.y = o.y;
      } else doc.objects.push(o);
    } else doc.objects.push(o);
    if (o.type === 'tree') doc.setTreeTrunk(o, true);
    if (o.type === 'desk') renameDesk(o);
    selectedId = o.type === 'spawn' ? null : o.id;
    if (!e.shiftKey) placing = null;
    say(e.shiftKey ? 'Placed (hold Shift to keep placing)' : 'Placed');
    changed();
    return;
  }
  if (pasting && e.button === 0) {
    pushUndo();
    const { skipped } = doc.paste(pasting, t.x, t.y, pasteOverlay);
    selection = { x: t.x, y: t.y, w: pasting.w, h: pasting.h };
    if (!e.shiftKey) pasting = null;
    say(skipped ? `Pasted (${skipped} building/spawn objects aren't duplicated)` : 'Pasted');
    changed();
    return;
  }
  if (e.button === 0 && e.altKey && tool !== 'objects') {
    eyedrop(t);
    return;
  }
  switch (tool) {
    case 'select':
      if (e.button !== 0) return;
      if (selection && inRect(selection, t) && !e.shiftKey) {
        drag = { kind: 'move', start: t, before: doc.snapshot(), dx: 0, dy: 0 };
      } else {
        drag = { kind: 'select', start: t, now: t };
        selection = null;
      }
      break;
    case 'rect':
      if (e.button === 0) drag = { kind: 'rect', start: t, now: t };
      break;
    case 'brush':
    case 'erase':
    case 'collision': {
      pushUndo();
      const d: Extract<Drag, { kind: 'paint' }> = {
        kind: 'paint',
        start: t,
        last: '',
        erase: tool === 'erase',
        solid: tool === 'collision' ? e.button === 0 : tool === 'erase' && e.shiftKey,
      };
      drag = d;
      d.last = `${t.x},${t.y}`;
      paintAt(t, d);
      changed({ inspector: false });
      break;
    }
    case 'objects': {
      if (e.button !== 0) return;
      const o = objectAt(mapPoint(e));
      selectedId = o?.id ?? null;
      if (o)
        drag = {
          kind: 'object',
          id: o.id,
          start: mapPoint(e),
          before: doc.snapshot(),
          ox: o.x,
          oy: o.y,
          moved: false,
        };
      changed({ base: false });
      break;
    }
  }
  redraw();
});

window.addEventListener('mousemove', (e) => {
  if (!doc) return;
  const over = e.target === view;
  const t = tileAt(e);
  const was = hover;
  hover = over || drag ? t : null;
  if (!drag) {
    if (was?.x !== hover?.x || was?.y !== hover?.y) redraw();
    return;
  }
  switch (drag.kind) {
    case 'pan':
      panX = drag.px + e.clientX - drag.sx;
      panY = drag.py + e.clientY - drag.sy;
      break;
    case 'select':
    case 'rect':
      drag.now = t;
      break;
    case 'move': {
      if (!selection) break;
      const dx = t.x - drag.start.x;
      const dy = t.y - drag.start.y;
      if (dx === drag.dx && dy === drag.dy) return;
      doc.restore(drag.before);
      const from = { ...selection, x: selection.x - drag.dx, y: selection.y - drag.dy };
      doc.move(from, dx, dy, layersToMove(), moveObjects);
      selection = { ...from, x: from.x + dx, y: from.y + dy };
      drag.dx = dx;
      drag.dy = dy;
      baseDirty = true;
      break;
    }
    case 'paint': {
      const key = `${t.x},${t.y}`;
      if (key === drag.last) return;
      drag.last = key;
      paintAt(t, drag);
      baseDirty = true;
      updateSaveState();
      break;
    }
    case 'object': {
      const p = mapPoint(e);
      const snap = e.shiftKey ? 1 : T;
      const dx = Math.round((p.x - drag.start.x) / snap) * snap;
      const dy = Math.round((p.y - drag.start.y) / snap) * snap;
      doc.restore(drag.before);
      const o = doc.objects.find((q) => q.id === (drag as { id: number }).id);
      if (!o) break;
      if (o.type === 'tree') doc.setTreeTrunk(o, false);
      shiftObject(o, dx, dy);
      if (o.type === 'tree') doc.setTreeTrunk(o, true);
      drag.moved = dx !== 0 || dy !== 0;
      baseDirty = true;
      break;
    }
  }
  redraw();
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  switch (d.kind) {
    case 'pan':
      stage.style.cursor = tool === 'objects' ? 'default' : 'crosshair';
      break;
    case 'select':
      selection = rectFrom(d.start, d.now);
      selection = clip(selection);
      break;
    case 'rect': {
      const r = clip(rectFrom(d.start, d.now));
      if (!r) break;
      pushUndo();
      const b = brushOnActive();
      for (let y = r.y; y < r.y + r.h; y += b.h)
        for (let x = r.x; x < r.x + r.w; x += b.w) {
          // Clip the last row/column of a big brush to the box.
          const part: Stamp = {
            ...b,
            w: Math.min(b.w, r.x + r.w - x),
            h: Math.min(b.h, r.y + r.h - y),
            layers: {},
          };
          const cells = b.layers[activeLayer]!;
          const out: number[] = [];
          for (let yy = 0; yy < part.h; yy++)
            for (let xx = 0; xx < part.w; xx++) out.push(cells[yy * b.w + xx]!);
          part.layers[activeLayer] = out;
          doc.writeTiles(part, x, y, true);
        }
      break;
    }
    case 'move':
      if (d.dx || d.dy) pushUndo(d.before);
      break;
    case 'object':
      if (d.moved) pushUndo(d.before);
      break;
  }
  changed();
});

view.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);
view.addEventListener('mouseleave', () => {
  if (!drag) {
    hover = null;
    redraw();
  }
});

function clip(r: Rect | null): Rect | null {
  if (!r) return null;
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(doc.w, r.x + r.w) - x;
  const hh = Math.min(doc.h, r.y + r.h) - y;
  return w > 0 && hh > 0 ? { x, y, w, h: hh } : null;
}

function eyedrop(t: { x: number; y: number }): void {
  let layer: TileLayer | undefined = doc.get(activeLayer, t.x, t.y) ? activeLayer : undefined;
  layer ??= [...TILE_LAYERS].reverse().find((l) => !hidden.has(l) && doc.get(l, t.x, t.y));
  if (!layer) return;
  activeLayer = layer;
  const gid = doc.get(layer, t.x, t.y);
  const i = gid - doc.tiles.firstgid;
  palettePick = { x: i % doc.tiles.columns, y: Math.floor(i / doc.tiles.columns), w: 1, h: 1 };
  brush = { w: 1, h: 1, layers: { [layer]: [gid] }, objects: [] };
  renderLayers();
  drawPalette();
  setTool(tool === 'rect' ? 'rect' : 'brush');
  say(`Picked tile ${gid} from ${layer}`);
}

function zoomAt(f: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2): void {
  const z = Math.max(0.25, Math.min(6, zoom * f));
  panX = cx - ((cx - panX) * z) / zoom;
  panY = cy - ((cy - panY) * z) / zoom;
  zoom = z;
  redraw();
}

function fit(): void {
  zoom = Math.max(
    0.25,
    Math.min((stage.clientWidth - 40) / (doc.w * T), (stage.clientHeight - 60) / (doc.h * T)),
  );
  panX = (stage.clientWidth - doc.w * T * zoom) / 2;
  panY = (stage.clientHeight - doc.h * T * zoom) / 2;
  redraw();
}

function renameDesk(o: MapObject): void {
  const names = new Set(doc.objects.filter((q) => q !== o && q.type === 'desk').map((q) => q.name));
  let n = 1;
  while (names.has(`desk-${n}`)) n++;
  o.name = `desk-${n}`;
}

// ---------- Keyboard ----------

window.addEventListener('keydown', (e) => {
  if (!doc) return;
  const typing = (e.target as HTMLElement).closest('input, select, textarea');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save();
    return;
  }
  if (typing) return;
  if (e.key === ' ') {
    spaceDown = true;
    stage.style.cursor = 'grab';
    e.preventDefault();
    return;
  }
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else if (k === 'c' && selection) copySelection(false);
    else if (k === 'x' && selection) copySelection(true);
    else if (k === 'v' && clipboard) startPaste(clipboard);
    else if (k === 'd' && selection) {
      copySelection(false);
      if (clipboard) startPaste(clipboard);
    } else if (k === 'a') {
      setTool('select');
      selection = { x: 0, y: 0, w: doc.w, h: doc.h };
      changed({ base: false });
    } else return;
    e.preventDefault();
    return;
  }
  const tool2 = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
  if (tool2) return setTool(tool2.id);
  switch (e.key) {
    case 'Escape':
      if (pasting || placing) {
        pasting = null;
        placing = null;
      } else {
        selection = null;
        selectedId = null;
      }
      changed({ base: false });
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelected();
      break;
    case 'g':
    case 'G':
      showGrid = !showGrid;
      $<HTMLInputElement>('show-grid').checked = showGrid;
      redraw();
      break;
    case 'h':
    case 'H':
      showCollision = !showCollision;
      $<HTMLInputElement>('show-collision').checked = showCollision;
      redraw();
      break;
    case '+':
    case '=':
      zoomAt(1.25);
      break;
    case '-':
      zoomAt(1 / 1.25);
      break;
    case '0':
      fit();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      nudge(dx, dy, e.shiftKey);
      break;
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    stage.style.cursor = tool === 'objects' ? 'default' : 'crosshair';
  }
});

function nudge(dx: number, dy: number, fine: boolean): void {
  const o = selectedObject();
  if (tool === 'objects' && o) {
    pushUndo();
    const step = fine ? 1 : T;
    if (o.type === 'tree') doc.setTreeTrunk(o, false);
    shiftObject(o, dx * step, dy * step);
    if (o.type === 'tree') doc.setTreeTrunk(o, true);
    changed();
  } else if (selection) {
    pushUndo();
    doc.move(selection, dx, dy, layersToMove(), moveObjects);
    selection = { ...selection, x: selection.x + dx, y: selection.y + dy };
    changed();
  } else {
    panX -= dx * 64;
    panY -= dy * 64;
    redraw();
  }
}

function copySelection(cut: boolean): void {
  if (!selection) return;
  clipboard = doc.copy(selection, layersToMove(), moveObjects);
  if (cut) {
    pushUndo();
    doc.clear(selection, layersToMove(), moveObjects);
    changed();
  }
  say(cut ? 'Cut — Ctrl+V to place it' : 'Copied — Ctrl+V to place a copy');
}

function startPaste(s: Stamp): void {
  setTool('select');
  pasting = s;
  say('Click to place (Shift+click to place several, Esc to stop)');
}

function deleteSelected(): void {
  const o = selectedObject();
  if (o && tool === 'objects') {
    if (o.type === 'spawn') return say("The spawn can't be deleted, only moved");
    pushUndo();
    if (o.type === 'tree') doc.setTreeTrunk(o, false);
    doc.objects.splice(doc.objects.indexOf(o), 1);
    selectedId = null;
    changed();
  } else if (selection) {
    pushUndo();
    doc.clear(selection, layersToMove(), moveObjects);
    changed();
    say('Cleared the selection');
  }
}

// ---------- Inspector ----------

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function check(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, label);
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: cls, textContent: label });
  b.addEventListener('click', onClick);
  return b;
}

function objectEditor(o: MapObject): HTMLElement {
  const card = h('div', { class: 'card' });
  const edit = (apply: () => void) => {
    pushUndo();
    apply();
    changed({ inspector: false });
  };
  const name = h('input', { value: o.name });
  name.addEventListener('change', () => edit(() => (o.name = name.value.trim() || o.name)));
  card.append(
    h('h3', {}, `${o.type} #${o.id}`),
    field('Name', name),
    field(
      'Position',
      h('span', {}, `${o.x}, ${o.y} px (tile ${Math.floor(o.x / T)}, ${Math.floor(o.y / T)})`),
    ),
  );
  if (o.type === 'desk') {
    const facing = h('select');
    for (const f of ['up', 'down', 'left', 'right'])
      facing.append(
        h('option', { value: f, textContent: f, selected: getProp(o, 'facing') === f }),
      );
    facing.addEventListener('change', () => edit(() => setProp(o, 'facing', facing.value)));
    card.append(field('Faces', facing));
  }
  for (const p of o.properties ?? []) {
    if (o.type === 'desk' && p.name === 'facing') continue;
    const input = h('input', { value: String(p.value) });
    input.addEventListener('change', () =>
      edit(() => {
        const n = Number(input.value);
        p.value =
          p.type === 'int' || p.type === 'float' ? (Number.isFinite(n) ? n : p.value) : input.value;
      }),
    );
    card.append(field(p.name, input));
  }
  if (o.type === 'desk' && !o.properties?.some((p) => p.name === 'table')) {
    const table = h('input', { placeholder: 'e.g. table-cafe' });
    table.addEventListener('change', () =>
      edit(() => table.value.trim() && setProp(o, 'table', table.value.trim())),
    );
    card.append(field('table', table));
  }
  const row = h('div', { class: 'row' });
  if (o.type !== 'spawn') row.append(button('Delete', () => deleteSelected(), 'danger'));
  row.append(
    button('Duplicate', () => {
      placing = structuredClone(o);
      say('Click to place the copy');
    }),
  );
  card.append(row, h('p', { class: 'hint' }, 'Drag to move (Shift: by the pixel). Arrows nudge.'));
  return card;
}

function addPanel(): HTMLElement {
  const card = h('div', { class: 'card' }, h('h3', {}, 'Add'));
  const trees = h('select');
  for (const [k, f] of Object.entries(art.trees.frames))
    trees.append(
      h('option', {
        value: k,
        textContent: `${k.replace('Camping_16x16_', '')} (${f.w / T}×${f.h / T})`,
      }),
    );
  const anims = h('select');
  for (const [k, n] of animNames(art.anims))
    anims.append(h('option', { value: k, textContent: `${k} (${n} frames)` }));
  const start = (o: MapObject) => {
    setTool('objects');
    placing = o;
    say('Click the map to place it (Shift+click to keep placing, Esc to stop)');
  };
  const base = (type: string, name: string, w: number, hh: number): MapObject => ({
    id: 0,
    name,
    type,
    x: 0,
    y: 0,
    width: w,
    height: hh,
    rotation: 0,
    visible: true,
  });
  card.append(
    field('Tree', trees),
    h(
      'div',
      { class: 'row' },
      button('Place tree', () => {
        const f = art.trees.frames[trees.value]!;
        start({
          ...base('tree', trees.value, f.w, f.h),
          properties: [{ name: 'trunk', type: 'int', value: 2 }],
        });
      }),
    ),
    field('Animation', anims),
    h(
      'div',
      { class: 'row' },
      button('Place animation', () => {
        const f = art.anims.frames[`${anims.value}:0`]!;
        const frames = animNames(art.anims).get(anims.value) ?? 1;
        start({
          ...base('anim', anims.value, f.w, f.h),
          properties: [
            { name: 'frames', type: 'int', value: frames },
            { name: 'fps', type: 'int', value: 8 },
          ],
        });
      }),
    ),
    h(
      'div',
      { class: 'row' },
      button('Desk (seat)', () =>
        start({
          ...base('desk', 'desk', T, T),
          properties: [{ name: 'facing', type: 'string', value: 'up' }],
        }),
      ),
      button('Butterflies', () => start(base('flowers', 'flowers', 2 * T, 2 * T))),
      button('Move spawn', () => start({ ...base('spawn', 'spawn', 0, 0), point: true })),
    ),
    h(
      'p',
      { class: 'hint' },
      'A desk is a seat players can focus at: put it on a chair and set which way they face. Trees make their trunk solid.',
    ),
  );
  return card;
}

function selectionPanel(): HTMLElement {
  const card = h('div', { class: 'card' });
  if (selection) {
    card.append(
      h('h3', {}, `Selection ${selection.w} × ${selection.h} at ${selection.x}, ${selection.y}`),
      h(
        'p',
        { class: 'hint' },
        'Drag inside it (or use the arrows) to move it. Ctrl+C / X / V / D copy, cut, paste, duplicate. Delete clears it.',
      ),
    );
  } else
    card.append(
      h('h3', {}, 'Moving parts of the town'),
      h(
        'p',
        { class: 'hint' },
        'Select a box around a building, a café or a park, then drag it somewhere else.',
      ),
    );
  card.append(
    check('Move the ground layer too', moveGround, (v) => {
      moveGround = v;
    }),
    check('Take the objects inside (desks, trees…)', moveObjects, (v) => {
      moveObjects = v;
    }),
    check('Paste over what is there (keep tiles under empty cells)', pasteOverlay, (v) => {
      pasteOverlay = v;
    }),
  );
  if (selection)
    card.append(
      h(
        'div',
        { class: 'row' },
        button('Copy', () => copySelection(false)),
        button('Cut', () => copySelection(true)),
        button('Clear', () => deleteSelected(), 'danger'),
      ),
    );
  return card;
}

function sizePanel(): HTMLElement {
  const card = h('div', { class: 'card' }, h('h3', {}, `Map size: ${doc.w} × ${doc.h} tiles`));
  const num = () => h('input', { type: 'number', value: '0', step: '1' });
  const [l, t, r, b] = [num(), num(), num(), num()];
  card.append(
    h(
      'p',
      { class: 'hint' },
      'Add (or remove, with negative numbers) rows and columns on each side. New space is grass.',
    ),
    field('Left', l),
    field('Top', t),
    field('Right', r),
    field('Bottom', b),
    h(
      'div',
      { class: 'row' },
      button('Resize', () => {
        const v = [l, t, r, b].map((i) => Math.trunc(Number(i.value) || 0)) as [
          number,
          number,
          number,
          number,
        ];
        if (v.every((n) => n === 0)) return;
        const before = doc.snapshot();
        try {
          const dropped = doc.resize(...v, doc.commonGround());
          pushUndo(before);
          if (selection) selection = null;
          panX -= v[0] * T * zoom;
          panY -= v[1] * T * zoom;
          resizeBase();
          changed();
          say(dropped ? `Resized; ${dropped} objects off the edge were removed` : 'Resized');
        } catch (err) {
          doc.restore(before);
          say(err instanceof Error ? err.message : String(err));
        }
      }),
    ),
  );
  return card;
}

function issuesPanel(): HTMLElement {
  const card = h('div', { class: 'card' }, h('h3', {}, 'Checks'));
  if (!issues.length) card.append(h('p', { class: 'ok' }, '✓ Spawn, desks and doors look fine.'));
  const list = h('div', { class: 'issues' });
  for (const i of issues) {
    const b = button(
      i.text,
      () => {
        if (!i.at) return;
        zoom = Math.max(zoom, 2);
        panX = stage.clientWidth / 2 - i.at.x * zoom;
        panY = stage.clientHeight / 2 - i.at.y * zoom;
        redraw();
      },
      `issue ${i.level}`,
    );
    list.append(b);
  }
  card.append(
    list,
    h(
      'div',
      { class: 'row' },
      button('Check again', () => {
        issues = doc.validate();
        renderInspector();
      }),
    ),
  );
  return card;
}

function renderInspector(): void {
  const o = selectedObject();
  const parts: HTMLElement[] = [
    h('h2', {}, TOOLS.find((t) => t.id === tool)!.label),
    h('p', { class: 'hint' }, TOOLS.find((t) => t.id === tool)!.hint),
  ];
  if (tool === 'objects') {
    if (o) parts.push(objectEditor(o));
    parts.push(addPanel());
  } else if (tool === 'select') {
    parts.push(selectionPanel(), sizePanel());
  } else if (tool === 'brush' || tool === 'rect' || tool === 'erase') {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `Painting on: ${activeLayer}`),
        h(
          'p',
          { class: 'hint' },
          'Pick the layer on the left. Buildings and furniture sit on "below", roofs and treetops on "above" (drawn over players).',
        ),
      ),
    );
  } else if (tool === 'collision') {
    parts.push(
      h(
        'div',
        { class: 'card' },
        h(
          'p',
          { class: 'hint' },
          'Red tiles are solid: players can’t walk there. Paint walls along buildings, water and furniture.',
        ),
      ),
    );
  }
  parts.push(issuesPanel());
  parts.push(
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Keys'),
      h(
        'ul',
        { class: 'help' },
        h('li', {}, 'Wheel: zoom · Space+drag or middle drag: pan'),
        h('li', {}, 'Ctrl+Z / Ctrl+Shift+Z: undo / redo'),
        h('li', {}, 'Ctrl+S: save (the game picks it up on reload)'),
        h('li', {}, 'Alt+click: pick a tile from the map'),
        h('li', {}, 'G grid · H collision · 0 fit'),
      ),
    ),
  );
  inspector.replaceChildren(...parts);
}

// ---------- Save ----------

function updateSaveState(): void {
  const dirty = doc.snapshot() !== savedSnapshot;
  const el = $('save-state');
  el.textContent = dirty ? 'Unsaved changes' : 'Saved';
  el.classList.toggle('dirty', dirty);
}

async function save(): Promise<void> {
  issues = doc.validate();
  renderInspector();
  const errors = issues.filter((i) => i.level === 'error');
  if (
    errors.length &&
    !confirm(
      `${errors.length} problem(s) found:\n\n${errors.map((i) => `• ${i.text}`).join('\n')}\n\nSave anyway?`,
    )
  )
    return;
  const btn = $<HTMLButtonElement>('save');
  btn.disabled = true;
  say('Saving…');
  try {
    const res = await fetch('/api/map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ map: doc.json, tmx: toTmx(doc.json), picture: thumbnail(doc, art) }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; backup?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    savedSnapshot = doc.snapshot();
    updateSaveState();
    say(
      `Saved at ${new Date().toLocaleTimeString()} — the game server restarts by itself; reload the game to see it`,
    );
  } catch (err) {
    say(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
  }
}

$('save').addEventListener('click', () => void save());
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('zoom-in').addEventListener('click', () => zoomAt(1.25));
$('zoom-out').addEventListener('click', () => zoomAt(1 / 1.25));
$('zoom-fit').addEventListener('click', fit);
$<HTMLInputElement>('show-grid').addEventListener('change', (e) => {
  showGrid = (e.target as HTMLInputElement).checked;
  redraw();
});
$<HTMLInputElement>('show-collision').addEventListener('change', (e) => {
  showCollision = (e.target as HTMLInputElement).checked;
  redraw();
});
$<HTMLInputElement>('show-boxes').addEventListener('change', (e) => {
  showBoxes = (e.target as HTMLInputElement).checked;
  redraw();
});
window.addEventListener('resize', redraw);
window.addEventListener('beforeunload', (e) => {
  if (doc && doc.snapshot() !== savedSnapshot) e.preventDefault();
});

// ---------- Start ----------

async function start(): Promise<void> {
  const [json, tiles, trees, anims] = await Promise.all([
    fetch('/api/map').then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the map (HTTP ${r.status})`);
      return r.json() as Promise<TiledMap>;
    }),
    loadImage('/assets/tilesets/town.png'),
    loadSheet('/assets/sprites/town-trees'),
    loadSheet('/assets/sprites/town-anims'),
  ]);
  doc = new TownDoc(json);
  art = { tiles, trees, anims };
  savedSnapshot = doc.snapshot();
  issues = doc.validate();
  resizeBase();
  pickFromPalette({ x: 0, y: 0, w: 1, h: 1 });
  setTool('select');
  renderLayers();
  updateSaveState();
  fit();
  // Exposed for scripted checks.
  (window as unknown as { __editor: object }).__editor = { doc: () => doc, save };
}

start().catch((err: unknown) => {
  document.body.textContent = err instanceof Error ? err.message : String(err);
});
