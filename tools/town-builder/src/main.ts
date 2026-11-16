import kitJson from '../kit/kit.json';
import kitPng from '../kit/kit.png';
import { compile, type Issue } from './compile';
import { groundFrames } from './ground';
import { CATEGORIES, footprintSize, T, type Cell, type Kit, type Prefab } from './kit';
import {
  blankLayout,
  GROUND,
  MAX_SIZE,
  MIN_SIZE,
  Town,
  type GroundChar,
  type Layout,
  type Piece,
} from './layout';

/**
 * The town builder: drag pieces from the tray onto the town, drag them around, paint the ground,
 * save. Everything snaps to the 16 px grid; green means a piece fits, red means it doesn't.
 */
const kit = kitJson as unknown as Kit;
const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;

const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;
const art = new Image();
art.src = kitPng;

let town: Town;
/** Ground pre-drawn at 1:1, redrawn when the ground changes. */
let groundCanvas = document.createElement('canvas');

// ---------------------------------------------------------------------------------------------
// View: zoom and pan. Map pixel (mx, my) is drawn at (ox + mx * zoom, oy + my * zoom).
// ---------------------------------------------------------------------------------------------

const view = { zoom: 2, ox: 0, oy: 0 };
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6];
let showGrid = false;

const toMap = (sx: number, sy: number) => ({
  x: (sx - view.ox) / view.zoom,
  y: (sy - view.oy) / view.zoom,
});
const toTile = (sx: number, sy: number) => {
  const m = toMap(sx, sy);
  return { x: Math.floor(m.x / T), y: Math.floor(m.y / T) };
};

/** The part of the screen the town can use (between the top bar and the tray). */
function viewport() {
  const tray = document.querySelector('.tray')!.getBoundingClientRect();
  return { top: 70, bottom: tray.top - 8, width: window.innerWidth };
}

function setZoom(zoom: number, sx = window.innerWidth / 2, sy = window.innerHeight / 2): void {
  const z = Math.max(ZOOMS[0]!, Math.min(ZOOMS[ZOOMS.length - 1]!, zoom));
  const m = toMap(sx, sy);
  view.zoom = z;
  view.ox = sx - m.x * z;
  view.oy = sy - m.y * z;
  $('zoom-label').textContent = `${Math.round(z * 100)}%`;
  redraw();
}

function fit(): void {
  const v = viewport();
  const z = Math.min(v.width / (town.width * T), (v.bottom - v.top) / (town.height * T)) * 0.95;
  view.zoom = Math.max(0.25, z);
  view.ox = (v.width - town.width * T * view.zoom) / 2;
  view.oy = v.top + (v.bottom - v.top - town.height * T * view.zoom) / 2;
  $('zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
  redraw();
}

function centerOn(tx: number, ty: number): void {
  const v = viewport();
  view.ox = v.width / 2 - (tx + 0.5) * T * view.zoom;
  view.oy = (v.top + v.bottom) / 2 - (ty + 0.5) * T * view.zoom;
  redraw();
}

// ---------------------------------------------------------------------------------------------
// What the user is doing
// ---------------------------------------------------------------------------------------------

type Mode =
  | { kind: 'select' }
  /** A piece follows the pointer. `sticky`: keep placing more after each click. */
  | { kind: 'place'; prefab: Prefab; sticky: boolean; fromTray: boolean }
  | { kind: 'paint'; ground: GroundChar };

let mode: Mode = { kind: 'select' };
let selected: Piece | null = null;
let hover = { x: -1, y: -1, sx: 0, sy: 0, onMap: false };
let brush = 1;
/** Moving a placed piece: where it was grabbed, relative to its top-left tile. */
let moving: { piece: Piece; dx: number; dy: number; x: number; y: number } | null = null;
let panning: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
/** Painting: the snapshot to undo to, and a box fill's first corner. */
let stroke: { before: string; boxFrom: { x: number; y: number } | null } | null = null;
let spaceDown = false;

// ---------------------------------------------------------------------------------------------
// Undo, and remembering unsaved work
// ---------------------------------------------------------------------------------------------

const undoStack: string[] = [];
const redoStack: string[] = [];
let savedSnapshot = '';

function commit(before: string): void {
  if (before === town.snapshot()) return;
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  changed();
}

function undo(): void {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(town.snapshot());
  town.restore(prev);
  selected = null;
  changed(true);
}

function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(town.snapshot());
  town.restore(next);
  selected = null;
  changed(true);
}

function changed(groundToo = true): void {
  if (groundToo) drawGround();
  refreshCards();
  showInspector();
  const dirty = town.snapshot() !== savedSnapshot;
  const status = $('status');
  status.textContent = dirty ? 'Unsaved changes' : 'Saved';
  status.classList.toggle('dirty', dirty);
  ($('undo') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('redo') as HTMLButtonElement).disabled = redoStack.length === 0;
  try {
    localStorage.setItem('town-builder:draft', town.snapshot());
  } catch {
    // Too big or blocked: the draft just isn't kept.
  }
  redraw();
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

function drawGround(): void {
  const c = document.createElement('canvas');
  c.width = town.width * T;
  c.height = town.height * T;
  const g = c.getContext('2d')!;
  for (let y = 0; y < town.height; y++) {
    for (let x = 0; x < town.width; x++) {
      const f = groundFrames(kit, town, x, y);
      g.drawImage(art, f.ground.x, f.ground.y, T, T, x * T, y * T, T, T);
      if (f.path) g.drawImage(art, f.path.x, f.path.y, T, T, x * T, y * T, T, T);
    }
  }
  groundCanvas = c;
}

let frameQueued = false;
function redraw(): void {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    draw();
  });
}

function drawPiece(prefab: Prefab, x: number, y: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  const f = prefab.frame;
  if (prefab.kind === 'spawn') {
    // A pin where players arrive.
    const cx = x * T + T / 2;
    const cy = y * T + T / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, y * T + T - 2, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ea5a44';
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 4);
    ctx.lineTo(cx + 4, cy - 4);
    ctx.lineTo(cx, cy + 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.drawImage(art, f.x, f.y, f.w, f.h, x * T, y * T, f.w, f.h);
  }
  ctx.globalAlpha = 1;
}

function fillCells(cells: Cell[], color: string): void {
  ctx.fillStyle = color;
  for (const [x, y] of cells) ctx.fillRect(x * T, y * T, T, T);
}

function outline(x: number, y: number, w: number, h: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width / view.zoom;
  ctx.strokeRect(x * T, y * T, w * T, h * T);
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(window.innerWidth * dpr) ||
    canvas.height !== Math.round(window.innerHeight * dpr)
  ) {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2b211b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.ox, dpr * view.oy);
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(groundCanvas, 0, 0);
  const placing = mode.kind === 'place' || moving !== null;

  // While placing or moving, every footprint shows, so you can see where there's room.
  if (placing) {
    for (const p of town.layout.pieces) {
      if (moving?.piece === p) continue;
      fillCells(town.baseCells(town.prefabOf(p), p.x, p.y), 'rgba(43, 28, 16, 0.28)');
    }
  }

  const pieces = [...town.layout.pieces].sort(
    (a, b) => a.y + town.prefabOf(a).h - (b.y + town.prefabOf(b).h) || a.x - b.x,
  );
  for (const p of pieces) {
    if (moving?.piece === p) continue;
    drawPiece(town.prefabOf(p), p.x, p.y);
  }
  // Signs over buildings.
  ctx.font = 'bold 7px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const p of pieces) {
    const f = town.prefabOf(p);
    const label = p.label ?? f.building?.label;
    if (!label || moving?.piece === p) continue;
    const tx = (p.x + f.w / 2) * T;
    const ty = (p.y + f.top) * T - 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1d1b2a';
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = '#fff3b0';
    ctx.fillText(label, tx, ty);
  }

  if (showGrid || placing || mode.kind === 'paint') {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1 / view.zoom;
    ctx.beginPath();
    for (let x = 0; x <= town.width; x++) {
      ctx.moveTo(x * T, 0);
      ctx.lineTo(x * T, town.height * T);
    }
    for (let y = 0; y <= town.height; y++) {
      ctx.moveTo(0, y * T);
      ctx.lineTo(town.width * T, y * T);
    }
    ctx.stroke();
  }
  outline(0, 0, town.width, town.height, 'rgba(255, 243, 176, 0.6)', 2);

  // Hover and selection.
  if (mode.kind === 'select' && !moving && hover.onMap) {
    const p = town.pieceAt(hover.x, hover.y);
    if (p && p !== selected) {
      const f = town.prefabOf(p);
      outline(p.x, p.y, f.w, f.h, 'rgba(255,255,255,0.8)', 1.5);
    }
  }
  if (selected && !moving) {
    const f = town.prefabOf(selected);
    fillCells(town.baseCells(f, selected.x, selected.y), 'rgba(146, 113, 216, 0.35)');
    outline(selected.x, selected.y, f.w, f.h, '#b493ff', 2.5);
  }

  // The piece in hand.
  const ghost = ghostAt();
  if (ghost) {
    const ok = town.check(ghost.prefab, ghost.x, ghost.y, moving?.piece).ok;
    fillCells(
      town.baseCells(ghost.prefab, ghost.x, ghost.y),
      ok ? 'rgba(94, 227, 122, 0.45)' : 'rgba(255, 77, 77, 0.5)',
    );
    drawPiece(ghost.prefab, ghost.x, ghost.y, 0.85);
    outline(ghost.x, ghost.y, ghost.prefab.w, ghost.prefab.h, ok ? '#5ee37a' : '#ff4d4d', 2);
  }

  // The paint brush.
  if (mode.kind === 'paint' && hover.onMap) {
    if (stroke?.boxFrom) {
      const b = boxCells(stroke.boxFrom, hover);
      fillCells(b, 'rgba(255, 243, 176, 0.35)');
    } else {
      fillCells(brushCells(hover.x, hover.y), 'rgba(255, 243, 176, 0.35)');
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  updateTip(ghost);
}

/** Where the piece in hand would go, if there is one. */
function ghostAt(): { prefab: Prefab; x: number; y: number } | null {
  if (!hover.onMap) return null;
  if (moving) return { prefab: town.prefabOf(moving.piece), x: moving.x, y: moving.y };
  if (mode.kind !== 'place') return null;
  const p = mode.prefab;
  // Held by the middle of its footprint's bottom row, so it lands where it's pointed at.
  return { prefab: p, x: hover.x - Math.floor(p.w / 2), y: hover.y - (p.h - 1) };
}

function updateTip(ghost: { prefab: Prefab; x: number; y: number } | null): void {
  const tip = $('tip');
  let text = '';
  if (ghost) {
    const check = town.check(ghost.prefab, ghost.x, ghost.y, moving?.piece);
    text = check.ok ? ghost.prefab.name : `${check.reason}`;
  }
  tip.hidden = !text;
  tip.textContent = text;
  tip.style.left = `${hover.sx}px`;
  tip.style.top = `${hover.sy}px`;
}

// ---------------------------------------------------------------------------------------------
// Painting ground
// ---------------------------------------------------------------------------------------------

function brushCells(cx: number, cy: number): Cell[] {
  const cells: Cell[] = [];
  const r0 = -Math.floor((brush - 1) / 2);
  for (let dy = 0; dy < brush; dy++)
    for (let dx = 0; dx < brush; dx++) cells.push([cx + r0 + dx, cy + r0 + dy]);
  return cells;
}

function boxCells(a: { x: number; y: number }, b: { x: number; y: number }): Cell[] {
  const cells: Cell[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) cells.push([x, y]);
  return cells;
}

// ---------------------------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------------------------

type Tab = (typeof CATEGORIES)[number]['id'] | 'ground';
let tab: Tab = 'buildings';
const thumbs = new Map<string, string>();

function thumbnail(p: Prefab): string {
  const known = thumbs.get(p.id);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = Math.max(T, p.frame.w);
  c.height = Math.max(T, p.frame.h);
  const g = c.getContext('2d')!;
  if (p.kind === 'spawn') {
    g.fillStyle = '#ea5a44';
    g.beginPath();
    g.arc(8, 6, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(4, 8);
    g.lineTo(12, 8);
    g.lineTo(8, 15);
    g.fill();
  } else {
    g.drawImage(art, p.frame.x, p.frame.y, p.frame.w, p.frame.h, 0, 0, p.frame.w, p.frame.h);
  }
  const url = c.toDataURL();
  thumbs.set(p.id, url);
  return url;
}

const GROUND_TOOLS: { ground: GroundChar; name: string; frame: () => { x: number; y: number } }[] =
  [
    { ground: GROUND.grass, name: 'Grass', frame: () => kit.terrain.grass[1]! },
    { ground: GROUND.paving, name: 'Paving', frame: () => kit.terrain.paving[0]![0]! },
    { ground: GROUND.water, name: 'Water', frame: () => kit.terrain.water.slice[4]! },
    { ground: GROUND.sand, name: 'Sand', frame: () => kit.terrain.sand.slice[4]! },
  ];

function groundThumb(frame: { x: number; y: number }): string {
  const c = document.createElement('canvas');
  c.width = c.height = 3 * T;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) g.drawImage(art, frame.x, frame.y, T, T, x * T, y * T, T, T);
  return c.toDataURL();
}

function buildTabs(): void {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  const all: { id: Tab; label: string }[] = [
    ...CATEGORIES.filter((c) => kit.prefabs.some((p) => p.category === c.id)),
    { id: 'ground', label: 'Ground' },
  ];
  for (const t of all) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.className = t.id === tab ? 'active' : '';
    b.onclick = () => {
      tab = t.id;
      buildTabs();
      buildCards();
    };
    tabs.append(b);
  }
}

function buildCards(): void {
  const cards = $('cards');
  cards.innerHTML = '';
  if (tab === 'ground') {
    for (const tool of GROUND_TOOLS) {
      const card = document.createElement('div');
      card.className = `piece-card${mode.kind === 'paint' && mode.ground === tool.ground ? ' active' : ''}`;
      card.innerHTML = `<div class="thumb"><img alt="" src="${groundThumb(tool.frame())}"></div><div class="name">${tool.name}</div>`;
      card.onclick = () => {
        setMode(
          mode.kind === 'paint' && mode.ground === tool.ground
            ? { kind: 'select' }
            : { kind: 'paint', ground: tool.ground },
        );
      };
      cards.append(card);
    }
    const sizes = document.createElement('div');
    sizes.className = 'brush-sizes';
    sizes.innerHTML = '<span>Brush</span>';
    const row = document.createElement('div');
    for (const n of [1, 2, 3, 5, 8]) {
      const b = document.createElement('button');
      b.textContent = `${n}`;
      b.className = n === brush ? 'active' : '';
      b.onclick = () => {
        brush = n;
        buildCards();
      };
      row.append(b);
    }
    sizes.append(row);
    const hint = document.createElement('span');
    hint.textContent = 'Shift+drag: fill a box';
    sizes.append(hint);
    cards.append(sizes);
    return;
  }
  for (const p of kit.prefabs.filter((f) => f.category === tab)) {
    const card = document.createElement('div');
    card.className = 'piece-card';
    card.dataset.prefab = p.id;
    const size = footprintSize(p);
    card.title = `${p.name} (${size.w}×${size.h})`;
    card.innerHTML = `<div class="thumb"><img alt="" src="${thumbnail(p)}"></div><div class="name">${p.name}</div><div class="size">${size.w}×${size.h}</div>`;
    card.addEventListener('pointerdown', (e) => startTrayDrag(e, p));
    cards.append(card);
  }
  refreshCards();
}

function refreshCards(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.piece-card[data-prefab]')) {
    const id = card.dataset.prefab!;
    const p = town.prefabs.get(id)!;
    card.classList.toggle(
      'used',
      Boolean(p.unique && town.layout.pieces.some((x) => x.prefab === id)),
    );
    card.classList.toggle('active', mode.kind === 'place' && mode.prefab.id === id);
  }
}

/** Press on a card: drag it onto the town, or just click it to place several. */
function startTrayDrag(e: PointerEvent, prefab: Prefab): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  setMode({ kind: 'place', prefab, sticky: false, fromTray: true });
  const move = (ev: PointerEvent) => onHover(ev.clientX, ev.clientY);
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const dragged = Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6;
    if (!dragged) {
      // A click: keep this piece in hand and place it with clicks on the town.
      setMode({ kind: 'place', prefab, sticky: !prefab.unique, fromTray: false });
      return;
    }
    if (overMap(ev.clientX, ev.clientY)) placeHeld();
    setMode({ kind: 'select' });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function overMap(sx: number, sy: number): boolean {
  const el = document.elementFromPoint(sx, sy);
  return el === canvas;
}

function setMode(m: Mode): void {
  mode = m;
  canvas.classList.toggle('placing', m.kind === 'place');
  canvas.classList.toggle('painting', m.kind === 'paint');
  if (m.kind !== 'select') selected = null;
  if (tab === 'ground') buildCards();
  refreshCards();
  showInspector();
  redraw();
}

/** Put the piece in hand down where it's pointed at, if it fits. */
function placeHeld(): boolean {
  const ghost = ghostAt();
  if (!ghost || mode.kind !== 'place') return false;
  if (!town.check(ghost.prefab, ghost.x, ghost.y).ok) return false;
  const before = town.snapshot();
  const piece = town.add(ghost.prefab, ghost.x, ghost.y);
  if (!mode.sticky) selected = piece;
  commit(before);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The selected piece
// ---------------------------------------------------------------------------------------------

function showInspector(): void {
  const panel = $('inspector');
  if (!selected || !town.layout.pieces.includes(selected)) {
    selected = null;
    panel.hidden = true;
    return;
  }
  const f = town.prefabOf(selected);
  panel.hidden = false;
  $('insp-name').textContent = f.name;
  const size = footprintSize(f);
  const extras: string[] = [`${size.w}×${size.h} tiles`, `at ${selected.x}, ${selected.y}`];
  if (f.seats) extras.push(`${f.seats.length} seats${f.group ? ', one shared Pomodoro' : ''}`);
  if (f.building?.doorCol !== undefined) extras.push('its door opens the shop');
  $('insp-info').textContent = extras.join(' · ');
  const labelRow = $('insp-label-row');
  labelRow.hidden = !f.building;
  const input = $<HTMLInputElement>('insp-label');
  if (document.activeElement !== input) input.value = selected.label ?? f.building?.label ?? '';
  ($('insp-dup') as HTMLButtonElement).disabled = Boolean(f.unique);
}

function removeSelected(): void {
  if (!selected) return;
  const before = town.snapshot();
  town.remove(selected);
  selected = null;
  commit(before);
}

function duplicateSelected(): void {
  if (!selected) return;
  const f = town.prefabOf(selected);
  if (f.unique) return;
  setMode({ kind: 'place', prefab: f, sticky: false, fromTray: false });
}

function nudge(dx: number, dy: number): void {
  if (!selected) return;
  const f = town.prefabOf(selected);
  if (!town.check(f, selected.x + dx, selected.y + dy, selected).ok) return;
  const before = town.snapshot();
  selected.x += dx;
  selected.y += dy;
  commit(before);
}

// ---------------------------------------------------------------------------------------------
// Pointer on the town
// ---------------------------------------------------------------------------------------------

function onHover(sx: number, sy: number): void {
  const t = toTile(sx, sy);
  hover = { x: t.x, y: t.y, sx, sy, onMap: overMap(sx, sy) };
  if (moving) {
    moving.x = t.x - moving.dx;
    moving.y = t.y - moving.dy;
  }
  canvas.classList.toggle(
    'over-piece',
    mode.kind === 'select' && !panning && town.pieceAt(t.x, t.y) !== null,
  );
  redraw();
}

canvas.addEventListener('pointerdown', (e) => {
  onHover(e.clientX, e.clientY);
  canvas.setPointerCapture(e.pointerId);
  const t = toTile(e.clientX, e.clientY);
  // Middle button or Space: look around, whatever else is going on.
  if (e.button === 1 || spaceDown) {
    panning = { sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false };
    canvas.classList.add('panning');
    return;
  }
  if (e.button === 2) {
    // Right click: put the piece in hand away.
    setMode({ kind: 'select' });
    return;
  }
  if (mode.kind === 'place') {
    if (placeHeld() && !mode.sticky) setMode({ kind: 'select' });
    return;
  }
  if (mode.kind === 'paint') {
    stroke = { before: town.snapshot(), boxFrom: e.shiftKey ? t : null };
    if (!stroke.boxFrom && town.paint(brushCells(t.x, t.y), mode.ground)) drawGround();
    redraw();
    return;
  }
  const hit = town.pieceAt(t.x, t.y);
  if (hit) {
    selected = hit;
    moving = { piece: hit, dx: t.x - hit.x, dy: t.y - hit.y, x: hit.x, y: hit.y };
    showInspector();
    redraw();
    return;
  }
  panning = { sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false };
  canvas.classList.add('panning');
});

canvas.addEventListener('pointermove', (e) => {
  if (panning) {
    view.ox = panning.ox + e.clientX - panning.sx;
    view.oy = panning.oy + e.clientY - panning.sy;
    if (Math.hypot(e.clientX - panning.sx, e.clientY - panning.sy) > 4) panning.moved = true;
  }
  onHover(e.clientX, e.clientY);
  if (stroke && mode.kind === 'paint' && !stroke.boxFrom && e.buttons & 1) {
    if (town.paint(brushCells(hover.x, hover.y), mode.ground)) drawGround();
  }
});

canvas.addEventListener('pointerup', () => {
  if (panning) {
    // A click on empty ground (no drag) deselects.
    if (!panning.moved) {
      selected = null;
      showInspector();
    }
    panning = null;
    canvas.classList.remove('panning');
  }
  if (moving) {
    const m = moving;
    moving = null;
    const f = town.prefabOf(m.piece);
    if ((m.x !== m.piece.x || m.y !== m.piece.y) && town.check(f, m.x, m.y, m.piece).ok) {
      const before = town.snapshot();
      m.piece.x = m.x;
      m.piece.y = m.y;
      commit(before);
    }
    // Snapshots replace the layout, so find the piece again by its id.
    selected = town.layout.pieces.find((p) => p.uid === m.piece.uid) ?? null;
    showInspector();
  }
  if (stroke && mode.kind === 'paint') {
    if (stroke.boxFrom) town.paint(boxCells(stroke.boxFrom, hover), mode.ground);
    const before = stroke.before;
    stroke = null;
    commit(before);
  }
  redraw();
});

canvas.addEventListener('pointerleave', () => {
  hover.onMap = false;
  redraw();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const i = ZOOMS.findIndex((z) => z >= view.zoom - 0.001);
    const next =
      e.deltaY < 0 ? ZOOMS[Math.min(ZOOMS.length - 1, i + 1)]! : ZOOMS[Math.max(0, i - 1)]!;
    setZoom(next, e.clientX, e.clientY);
  },
  { passive: false },
);

// ---------------------------------------------------------------------------------------------
// Keys and buttons
// ---------------------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (ctrl && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (ctrl && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save();
  } else if (e.key === 'Escape') {
    if (moving) {
      moving = null;
    } else if (mode.kind !== 'select') {
      setMode({ kind: 'select' });
    } else {
      selected = null;
      showInspector();
    }
    redraw();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    removeSelected();
  } else if (e.key.toLowerCase() === 'd' && selected) {
    duplicateSelected();
  } else if (e.key.toLowerCase() === 'g') {
    showGrid = !showGrid;
    ($('show-grid') as HTMLInputElement).checked = showGrid;
    redraw();
  } else if (e.key.toLowerCase() === 'f') {
    fit();
  } else if (e.key === '+' || e.key === '=') {
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z >= view.zoom - 0.001) + 1)]!);
  } else if (e.key === '-') {
    setZoom(ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z >= view.zoom - 0.001) - 1)]!);
  } else if (e.key === ' ') {
    spaceDown = true;
    e.preventDefault();
  } else if (selected && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      e.key
    ] as [number, number];
    nudge(d[0], d[1]);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
});
window.addEventListener('resize', redraw);
window.addEventListener('beforeunload', (e) => {
  if (town.snapshot() !== savedSnapshot) e.preventDefault();
});

$('undo').onclick = undo;
$('redo').onclick = redo;
$('zoom-in').onclick = () =>
  setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z >= view.zoom - 0.001) + 1)]!);
$('zoom-out').onclick = () =>
  setZoom(ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z >= view.zoom - 0.001) - 1)]!);
$('zoom-fit').onclick = fit;
$<HTMLInputElement>('show-grid').onchange = (e) => {
  showGrid = (e.target as HTMLInputElement).checked;
  redraw();
};
$('help-toggle').onclick = () => {
  const body = $('help-body');
  body.hidden = !body.hidden;
  $('help-toggle').textContent = body.hidden ? '+' : '−';
};
$('insp-close').onclick = () => {
  selected = null;
  showInspector();
  redraw();
};
$('insp-del').onclick = removeSelected;
$('insp-dup').onclick = duplicateSelected;
$<HTMLInputElement>('insp-label').addEventListener('change', (e) => {
  if (!selected) return;
  const before = town.snapshot();
  selected.label = (e.target as HTMLInputElement).value.trim();
  commit(before);
});
$('issues-close').onclick = () => ($('issues').hidden = true);

const sizeDialog = $<HTMLDialogElement>('size-dialog');
$('map-size').onclick = () => {
  $('size-now').textContent = `Now ${town.width} × ${town.height} tiles.`;
  for (const id of ['grow-left', 'grow-top', 'grow-right', 'grow-bottom'])
    $<HTMLInputElement>(id).value = '0';
  sizeDialog.showModal();
};
sizeDialog.addEventListener('close', () => {
  if (sizeDialog.returnValue !== 'ok') return;
  const n = (id: string) => Math.trunc(Number($<HTMLInputElement>(id).value) || 0);
  const left = n('grow-left');
  const top = n('grow-top');
  const width = town.width + left + n('grow-right');
  const height = town.height + top + n('grow-bottom');
  if (width < MIN_SIZE || height < MIN_SIZE || width > MAX_SIZE || height > MAX_SIZE) {
    alert(`The town must be between ${MIN_SIZE} and ${MAX_SIZE} tiles each way.`);
    return;
  }
  const before = town.snapshot();
  town.resize(width, height, left, top);
  selected = null;
  commit(before);
  fit();
});
$('start-over').onclick = () => {
  if (!confirm('Clear everything and start from an empty field? (Undo can bring it back.)')) return;
  const before = town.snapshot();
  town.restore(JSON.stringify(blankLayout(town.width, town.height)));
  selected = null;
  commit(before);
  sizeDialog.close();
};

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

function showIssues(issues: Issue[]): void {
  const list = $('issues-list');
  list.innerHTML = '';
  for (const issue of issues) {
    const li = document.createElement('li');
    li.className = issue.level;
    li.textContent = issue.message;
    if (issue.at) li.onclick = () => centerOn(issue.at!.x, issue.at!.y);
    list.append(li);
  }
  $('issues').hidden = issues.length === 0;
}

async function save(): Promise<void> {
  const status = $('status');
  status.textContent = 'Checking…';
  const out = compile(town, kit, art);
  showIssues(out.issues);
  if (out.issues.some((i) => i.level === 'error')) {
    status.textContent = 'Fix the problems first';
    return;
  }
  status.textContent = 'Saving…';
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      layout: town.layout,
      map: out.map,
      tmx: out.tmx,
      tileset: out.tileset,
      trees: out.trees,
      anims: out.anims,
      picture: out.picture,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    status.textContent = `Not saved: ${body.error ?? res.statusText}`;
    return;
  }
  savedSnapshot = town.snapshot();
  try {
    localStorage.removeItem('town-builder:draft');
  } catch {
    // Fine.
  }
  changed(false);
  status.textContent = out.issues.length
    ? 'Saved (see the notes)'
    : 'Saved: the game has the new town';
}
$('save').onclick = () => void save();

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

async function start(): Promise<void> {
  await new Promise((resolve, reject) => {
    if (art.complete && art.naturalWidth) resolve(null);
    art.onload = resolve;
    art.onerror = reject;
  });
  const res = await fetch('/api/layout');
  const saved = res.ok ? ((await res.json()) as Layout) : blankLayout(68, 50);
  town = new Town(kit, saved);
  savedSnapshot = town.snapshot();
  // Unsaved work from last time comes back.
  try {
    const draft = localStorage.getItem('town-builder:draft');
    if (
      draft &&
      draft !== savedSnapshot &&
      confirm('Pick up where you left off? (Your last changes were not saved.)')
    ) {
      town.restore(draft);
    }
  } catch {
    // No draft.
  }
  drawGround();
  buildTabs();
  buildCards();
  fit();
  changed(false);
}

void start();

// For browser tests: where tiles are on screen, and the town itself.
(window as unknown as { __builder: object }).__builder = {
  view,
  get town() {
    return town;
  },
  tileToScreen: (tx: number, ty: number) => ({
    x: view.ox + (tx + 0.5) * T * view.zoom,
    y: view.oy + (ty + 0.5) * T * view.zoom,
  }),
};
