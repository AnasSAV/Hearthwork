import type Phaser from 'phaser';
import {
  houseWorld,
  TILE_SIZE,
  YARD,
  YARD_HOUSE,
  YARD_RESERVED,
  YARD_ROOM,
  YARD_SIGN,
  YARD_SPRITES,
  type HouseDims,
} from '@focus-town/shared';
import { ABOVE_DEPTH } from './depths';
import { HOUSES_KEY } from './exteriors';
import { SHEETS, tileFrame } from './frames';

/** The paths (from the door down, and across to the gate): YARD_RESERVED entries 1 and 2. */
const PATHS = [YARD_RESERVED[1]!, YARD_RESERVED[2]!];

/**
 * Draws a home's yard: grass, paths, the fence with its gate to town, the "Town" signpost and
 * the house exterior for its level and style. Garden items are drawn with the furniture
 * (InteriorView), since they're part of the layout.
 */
export class YardView {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(dims: HouseDims, level: number, style: string, textResolution: number): void {
    this.clear();
    const o = houseWorld.roomOrigin(dims, YARD_ROOM);
    const piece = (name: string, dx = 0, dy = 0) => {
      const r = YARD_SPRITES[name]!;
      return tileFrame(this.scene, SHEETS.yard, r[0] + dx, r[1] + dy);
    };
    const onPath = (x: number, y: number) =>
      PATHS.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);

    for (let y = 0; y < YARD.height; y++) {
      for (let x = 0; x < YARD.width; x++) {
        const frame = onPath(x, y)
          ? piece('path', x % 2, y % 2)
          : piece((x * 7 + y * 13) % 5 === 0 ? 'grass_tuft' : 'grass');
        this.tile(frame, o.x + x, o.y + y, -20);
      }
    }
    // The gate: path tiles in the gap of the left fence.
    for (const g of houseWorld.gateTiles()) this.tile(piece('path', 0, g.y % 2), g.x, g.y, -20);

    // Fence ring around the yard.
    const right = o.x + YARD.width;
    const bottom = o.y + YARD.height;
    const gates = new Set(houseWorld.gateTiles().map((g) => g.y));
    for (let x = 0; x <= right; x++) {
      const top = x === 0 ? 'fence_tl' : x === right ? 'fence_tr' : 'fence_t';
      const low = x === 0 ? 'fence_bl' : x === right ? 'fence_br' : 'fence_b';
      this.tile(piece(top), x, 0, -19);
      this.tile(piece(low), x, bottom, bottom * TILE_SIZE + TILE_SIZE);
    }
    for (let y = 1; y < bottom; y++) {
      if (!gates.has(y)) this.tile(piece('fence_l'), 0, y, -19);
      this.tile(piece('fence_r'), right, y, -19);
    }

    // Signpost above the gate, and its label.
    const sign = YARD_SPRITES.sign!;
    const signX = (o.x + YARD_SIGN.x) * TILE_SIZE;
    const signBottom = (o.y + YARD_SIGN.y + 1) * TILE_SIZE;
    this.objects.push(
      this.scene.add
        .image(
          signX,
          signBottom,
          SHEETS.yard,
          tileFrame(this.scene, SHEETS.yard, sign[0], sign[1], 1, 2),
        )
        .setOrigin(0, 1)
        .setDepth(signBottom),
      this.scene.add
        .text(signX + TILE_SIZE / 2, signBottom - 2 * TILE_SIZE - 1, 'Town', {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '6px',
          fontStyle: 'bold',
          color: '#fff3b0',
          stroke: '#1d1b2a',
          strokeThickness: 2,
          resolution: textResolution,
        })
        .setOrigin(0.5, 1)
        .setDepth(ABOVE_DEPTH + 1),
    );

    // The house, bottom-left on its plot; the door is always in its column 2.
    const houseBottom = (o.y + YARD_HOUSE.bottom) * TILE_SIZE;
    const frame = `${style === 'brick' ? 'brick' : 'cottage'}-${Math.min(3, Math.max(1, level))}`;
    this.objects.push(
      this.scene.add
        .image((o.x + YARD_HOUSE.x) * TILE_SIZE, houseBottom, HOUSES_KEY, frame)
        .setOrigin(0, 1)
        .setDepth(houseBottom),
    );
  }

  clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  private tile(frame: string, x: number, y: number, depth: number): void {
    this.objects.push(
      this.scene.add
        .image(x * TILE_SIZE, y * TILE_SIZE, SHEETS.yard, frame)
        .setOrigin(0)
        .setDepth(depth),
    );
  }
}
