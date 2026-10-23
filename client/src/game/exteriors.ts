import type Phaser from 'phaser';
import { TILE_SIZE } from '@focus-town/shared';
import { SHEETS, tinyFrame } from './frames';

/** Tiny Town tile indices for the two exterior styles. */
const STYLES = {
  cottage: {
    top: [48, 49, 50],
    chimney: 51,
    low: [60, 61, 62],
    gable: 63,
    wall: { l: 72, r: 75, win: 84, door: 85 },
  },
  brick: {
    top: [52, 53, 54],
    chimney: 55,
    low: [64, 65, 66],
    gable: 67,
    wall: { l: 76, r: 79, win: 88, door: 89 },
  },
} as const;

/**
 * Tile rows (roof, roof with gable, wall with door) for a house of the given level, as
 * [column offset within the 5-wide lot, tile index]. The door is always in lot column 2 so the
 * doorstep stays put as the house grows: L1 is 3 wide, L2 4 wide, L3 5 wide with a chimney.
 */
function houseTiles(level: number, styleName: string): [number, number, number][] {
  const s = STYLES[styleName === 'brick' ? 'brick' : 'cottage'];
  const width = level >= 3 ? 5 : level === 2 ? 4 : 3;
  const start = level >= 3 ? 0 : level === 2 ? 0 : 1;
  const doorCol = 2 - start;
  const out: [number, number, number][] = [];
  for (let c = 0; c < width; c++) {
    const edge = c === 0 ? 0 : c === width - 1 ? 2 : 1;
    const top = level >= 3 && c === 0 ? s.chimney : s.top[edge]!;
    out.push([start + c, 0, top]);
    out.push([start + c, 1, c === doorCol ? s.gable : s.low[edge]!]);
    const wall =
      c === 0 ? s.wall.l : c === width - 1 ? s.wall.r : c === doorCol ? s.wall.door : s.wall.win;
    out.push([start + c, 2, wall]);
  }
  return out;
}

/** Draws one lot: the owner's house with a name label, or a "for sale" sign. */
export class LotView {
  private container: Phaser.GameObjects.Container;
  readonly label: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly origin: { x: number; y: number },
    textResolution: number,
  ) {
    this.container = scene.add.container(origin.x, origin.y).setDepth(-9);
    this.label = scene.add
      .text(origin.x + 2.5 * TILE_SIZE, origin.y - 2, '', {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#fff3b0',
        stroke: '#1d1b2a',
        strokeThickness: 2,
        resolution: textResolution,
      })
      .setOrigin(0.5, 1)
      .setDepth(-5);
    this.show(null);
  }

  show(house: { ownerName: string; level: number; style: string } | null): void {
    this.container.removeAll(true);
    if (!house) {
      this.container.add(
        this.scene.add
          .image(2 * TILE_SIZE, 2 * TILE_SIZE, SHEETS.tinytown, tinyFrame(this.scene, 83))
          .setOrigin(0),
      );
      this.label.setText('For sale');
      return;
    }
    for (const [col, row, tile] of houseTiles(house.level, house.style)) {
      this.container.add(
        this.scene.add
          .image(col * TILE_SIZE, row * TILE_SIZE, SHEETS.tinytown, tinyFrame(this.scene, tile))
          .setOrigin(0),
      );
    }
    this.label.setText(`${house.ownerName}'s house`);
  }
}
