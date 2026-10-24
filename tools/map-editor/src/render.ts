import { T, TILE_LAYERS, type MapObject, type TileLayer, type TownDoc } from './model';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sheet {
  img: HTMLImageElement;
  frames: Record<string, Frame>;
}

export interface Art {
  tiles: HTMLImageElement;
  trees: Sheet;
  anims: Sheet;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}

export async function loadSheet(base: string): Promise<Sheet> {
  const [img, json] = await Promise.all([
    loadImage(`${base}.png`),
    fetch(`${base}.json`).then(
      (r) => r.json() as Promise<{ frames: Record<string, { frame: Frame }> }>,
    ),
  ]);
  return {
    img,
    frames: Object.fromEntries(Object.entries(json.frames).map(([k, v]) => [k, v.frame])),
  };
}

/** Anim names and their frame counts, from "<name>:<i>" frames. */
export function animNames(s: Sheet): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of Object.keys(s.frames)) {
    const [name, i] = key.split(':');
    if (name && i !== undefined) out.set(name, Math.max(out.get(name) ?? 0, Number(i) + 1));
  }
  return out;
}

/**
 * Draws the map at 1 px per pixel, in the game's order: ground and the "below" layers, then
 * trees and animations sorted by their feet, then the "above" layers.
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  doc: TownDoc,
  art: Art,
  visible: (l: TileLayer | 'objects') => boolean,
): void {
  const cols = doc.tiles.columns;
  ctx.imageSmoothingEnabled = false;
  const layer = (name: TileLayer) => {
    if (!visible(name)) return;
    const data = doc.data(name);
    for (let i = 0; i < data.length; i++) {
      const gid = data[i]!;
      if (!gid || gid >= doc.collisionGid) continue;
      const t = gid - doc.tiles.firstgid;
      ctx.drawImage(
        art.tiles,
        (t % cols) * T,
        Math.floor(t / cols) * T,
        T,
        T,
        (i % doc.w) * T,
        Math.floor(i / doc.w) * T,
        T,
        T,
      );
    }
  };
  const below = TILE_LAYERS.filter((l) => !l.startsWith('above'));
  const above = TILE_LAYERS.filter((l) => l.startsWith('above'));
  below.forEach(layer);
  if (visible('objects')) {
    const sprites = doc.objects
      .filter((o) => o.type === 'tree' || o.type === 'anim')
      .sort((a, b) => a.y + a.height - (b.y + b.height));
    for (const o of sprites) drawSprite(ctx, o, art);
  }
  above.forEach(layer);
}

export function drawSprite(ctx: CanvasRenderingContext2D, o: MapObject, art: Art): void {
  const sheet = o.type === 'tree' ? art.trees : art.anims;
  const f = sheet.frames[o.type === 'tree' ? o.name : `${o.name}:0`];
  if (f) ctx.drawImage(sheet.img, f.x, f.y, f.w, f.h, o.x, o.y, f.w, f.h);
}

/** The small picture of the town on the world map and minimap (4 px a tile). */
export function thumbnail(doc: TownDoc, art: Art): string {
  const full = document.createElement('canvas');
  full.width = doc.w * T;
  full.height = doc.h * T;
  const fctx = full.getContext('2d')!;
  fctx.fillStyle = '#000';
  fctx.fillRect(0, 0, full.width, full.height);
  drawMap(fctx, doc, art, () => true);
  // Halve twice with smoothing for a clean 1/4 picture.
  let src: HTMLCanvasElement = full;
  for (let k = 0; k < 2; k++) {
    const c = document.createElement('canvas');
    c.width = src.width / 2;
    c.height = src.height / 2;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    src = c;
  }
  return src.toDataURL('image/png');
}
