import type Phaser from 'phaser';
import {
  CATALOG_BY_ID,
  coveredTiles,
  houseWorld,
  linkY,
  spriteKey,
  TILE_SIZE,
  type HouseDims,
} from '@focus-town/shared';
import type { EditItem } from '../house/editor';
import { itemFrame, SHEETS, tileFrame } from './frames';

/** house.png frames: 0 floor, 1 wall, 2 outer wall, 3 door mat. */
const HOUSE_TILE = { floor: 0, wall: 1, outer: 2, mat: 3 } as const;

export interface InteriorLook {
  /** Item ids; null/'' = default. */
  wallpaper: string | null;
  floor: string | null;
}

/**
 * Draws a house interior: outer walls, wallpaper row, floor and furniture. Item depths follow
 * their bottom edge so players walk in front of and behind furniture naturally.
 */
export class InteriorView {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(dims: HouseDims, look: InteriorLook, items: readonly EditItem[]): void {
    this.clear();
    const w = houseWorld.width(dims);
    const h = houseWorld.height(dims);
    const wallTex = this.lookFrame(look.wallpaper, HOUSE_TILE.wall);
    const floorTex = this.lookFrame(look.floor, HOUSE_TILE.floor);
    const outer = {
      sheet: SHEETS.house,
      frame: tileFrame(this.scene, SHEETS.house, HOUSE_TILE.outer, 0),
    };

    // Start with outer wall everywhere, then carve out the rooms.
    const kind: ('outer' | 'wall' | 'floor')[] = new Array(w * h).fill('outer');
    for (let r = 0; r < dims.rooms; r++) {
      const o = houseWorld.roomOrigin(dims, r);
      for (let x = 0; x < dims.width; x++) {
        kind[o.y * w + o.x + x] = 'wall';
        for (let y = 1; y < dims.height; y++) kind[(o.y + y) * w + o.x + x] = 'floor';
      }
      if (r > 0) kind[(o.y + linkY(dims)) * w + o.x - 1] = 'floor';
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = kind[y * w + x]!;
        const tex = k === 'wall' ? wallTex : k === 'floor' ? floorTex : outer;
        this.tile(tex.sheet, tex.frame, x, y, -20);
      }
    }
    const exit = houseWorld.exitTile(dims);
    this.tile(
      SHEETS.house,
      tileFrame(this.scene, SHEETS.house, HOUSE_TILE.mat, 0),
      exit.x,
      exit.y,
      -19,
    );

    // Furniture.
    const hostBottom = new Map<string, number>(); // `${room}:${x}:${y}` → bottom px of the table there
    const sorted = [...items].sort(
      (a, b) =>
        Number(CATALOG_BY_ID.get(a.itemId)?.layer === 'surface') -
        Number(CATALOG_BY_ID.get(b.itemId)?.layer === 'surface'),
    );
    for (const p of sorted) {
      const item = CATALOG_BY_ID.get(p.itemId);
      if (!item) continue;
      const o = houseWorld.roomOrigin(dims, p.room);
      const left = (o.x + p.x) * TILE_SIZE;
      const bottom = (o.y + p.y + item.sprite.h) * TILE_SIZE;
      let depth: number;
      if (item.layer === 'rug') depth = -15;
      else if (item.layer === 'wall') depth = -14;
      else if (item.layer === 'surface') {
        const t = coveredTiles(item, { ...p, rotation: 0 })[0]!;
        depth = (hostBottom.get(`${p.room}:${t.x}:${t.y}`) ?? bottom) + 0.5;
      } else {
        depth = bottom;
        if (item.surfaceHost) {
          for (const t of coveredTiles(item, { ...p, rotation: 0 }))
            hostBottom.set(`${p.room}:${t.x}:${t.y}`, bottom);
        }
      }
      const f = itemFrame(this.scene, spriteKey(item.sprite));
      if (!f) continue;
      this.objects.push(
        this.scene.add.image(left, bottom, f.sheet, f.frame).setOrigin(0, 1).setDepth(depth),
      );
    }
  }

  clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  private lookFrame(itemId: string | null, fallback: number): { sheet: string; frame: string } {
    const item = itemId ? CATALOG_BY_ID.get(itemId) : undefined;
    const f = item && itemFrame(this.scene, spriteKey(item.sprite));
    return f ?? { sheet: SHEETS.house, frame: tileFrame(this.scene, SHEETS.house, fallback, 0) };
  }

  private tile(sheet: string, frame: string, x: number, y: number, depth: number): void {
    this.objects.push(
      this.scene.add
        .image(x * TILE_SIZE, y * TILE_SIZE, sheet, frame)
        .setOrigin(0)
        .setDepth(depth),
    );
  }
}
