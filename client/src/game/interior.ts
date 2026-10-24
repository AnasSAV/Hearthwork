import type Phaser from 'phaser';
import {
  CATALOG_BY_ID,
  coveredTiles,
  defaultRoomSprite,
  houseWorld,
  linkY,
  roomBorderSprite,
  spriteKey,
  TILE_SIZE,
  type HouseDims,
  type SpriteRect,
} from '@focus-town/shared';
import type { EditItem } from '../house/editor';
import { itemFrame, tileFrame } from './frames';
import { swayCanopy } from './life';

export interface InteriorLook {
  /** Item ids; null/'' = default. */
  wallpaper: string | null;
  floor: string | null;
}

/**
 * Draws a house interior: a dark border, walls two tiles tall (the border row above each room
 * shows the top of its wall), repeating floor blocks and the furniture. Item depths follow
 * their bottom edge so players walk in front of and behind furniture naturally.
 */
export class InteriorView {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(dims: HouseDims, look: InteriorLook, items: readonly EditItem[]): void {
    this.clear();
    const wall = this.lookSprite(look.wallpaper, 'wall');
    const floor = this.lookSprite(look.floor, 'floor');
    const border = roomBorderSprite();
    // One tile of a 3x2 wall/floor block. Floors repeat the whole block; walls repeat its
    // middle column (the outer columns are end pieces with a seam).
    const blockTile = (s: SpriteRect, x: number, y: number) =>
      tileFrame(this.scene, s.sheet, s.x + (x % s.w), s.y + (y % s.h));
    const floorAt = (x: number, y: number) =>
      this.tile(floor.sheet, blockTile(floor, x, y), x, y, -20);

    const area = houseWorld.interiorBounds(dims);
    for (let y = area.y; y < area.y + area.h; y++)
      for (let x = area.x; x < area.x + area.w; x++)
        this.tile(border.sheet, tileFrame(this.scene, border.sheet, border.x, border.y), x, y, -21);
    for (let r = 0; r < dims.rooms; r++) {
      const o = houseWorld.roomOrigin(dims, r);
      for (let x = 0; x < dims.width; x++) {
        const wx = o.x + x;
        this.tile(wall.sheet, blockTile(wall, 1, 0), wx, o.y - 1, -20);
        this.tile(wall.sheet, blockTile(wall, 1, 1), wx, o.y, -20);
        for (let y = 1; y < dims.height; y++) floorAt(wx, o.y + y);
      }
      if (r > 0) floorAt(o.x - 1, o.y + linkY(dims));
    }
    const exit = houseWorld.exitTile(dims);
    floorAt(exit.x, exit.y);

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
      const bottom = (o.y + p.y + item.size.h) * TILE_SIZE;
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
      const image = this.scene.add
        .image(left, bottom, f.sheet, f.frame)
        .setOrigin(0, 1)
        .setDepth(depth);
      this.objects.push(image);
      if (item.id.startsWith('garden_tree')) {
        // Garden trees: the canopy is a second copy, cropped, swaying over a still trunk.
        const h = item.sprite.h * TILE_SIZE;
        const trunk = item.size.h * TILE_SIZE;
        image.setCrop(0, h - trunk, item.sprite.w * TILE_SIZE, trunk);
        const canopy = this.scene.add
          .image(left, bottom, f.sheet, f.frame)
          .setOrigin(0, 1)
          .setCrop(0, 0, item.sprite.w * TILE_SIZE, h - trunk + 4)
          .setDepth(depth + 0.1);
        swayCanopy(this.scene, canopy, left);
        this.objects.push(canopy);
      }
    }
  }

  clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  private lookSprite(itemId: string | null, kind: 'wall' | 'floor'): SpriteRect {
    const item = itemId ? CATALOG_BY_ID.get(itemId) : undefined;
    return item?.category === kind ? item.sprite : defaultRoomSprite(kind);
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
