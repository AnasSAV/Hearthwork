import type Phaser from 'phaser';
import { ABOVE_DEPTH } from './depths';

/** Atlas with house exteriors (`<style>-<level>`) and the "for sale" sign; see tools/art. */
export const HOUSES_KEY = 'houses';

/**
 * Draws one lot: the owner's house for its level and style, or a "for sale" sign. Houses sit
 * on the lot's bottom-left corner with their door in lot column 2 at every level, so the
 * doorstep never moves. The lot is solid, so sorting by its bottom edge keeps players who walk
 * behind a house hidden behind it.
 */
export class LotView {
  private readonly image: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lot: { x: number; y: number; width: number; height: number },
    textResolution: number,
  ) {
    const bottom = lot.y + lot.height;
    this.image = scene.add
      .image(lot.x, bottom, HOUSES_KEY, 'sale')
      .setOrigin(0, 1)
      .setDepth(bottom);
    this.label = scene.add
      .text(lot.x + lot.width / 2, bottom, '', {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#fff3b0',
        stroke: '#1d1b2a',
        strokeThickness: 2,
        resolution: textResolution,
      })
      .setOrigin(0.5, 1)
      .setDepth(ABOVE_DEPTH + 1);
    this.show(null);
  }

  show(house: { ownerName: string; level: number; style: string } | null): void {
    const bottom = this.lot.y + this.lot.height;
    if (!house) {
      this.image.setFrame('sale').setPosition(this.lot.x + this.lot.width / 2 - 8, bottom - 16);
      this.label.setText('For sale').setPosition(this.lot.x + this.lot.width / 2, bottom - 50);
      return;
    }
    const style = house.style === 'brick' ? 'brick' : 'cottage';
    const level = Math.min(3, Math.max(1, house.level));
    this.image.setFrame(`${style}-${level}`).setPosition(this.lot.x, bottom);
    this.label
      .setText(`${house.ownerName}'s house`)
      .setPosition(this.image.x + this.image.width / 2, bottom - this.image.height - 1);
  }
}
