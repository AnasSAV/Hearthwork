import type Phaser from 'phaser';
import { parseSpriteKey, type SpriteRect } from '@focus-town/shared';

/** Texture keys loaded in BootScene. */
export const SHEETS = { indoor: 'indoor', tinytown: 'tinytown', house: 'house' } as const;

/**
 * Frame name for a rectangle of 16×16 tiles in a loaded sheet, adding the frame on first use.
 * Lets us draw any catalog item (or multi-tile building piece) as a single image.
 */
export function tileFrame(
  scene: Phaser.Scene,
  sheet: string,
  x: number,
  y: number,
  w = 1,
  h = 1,
): string {
  const name = `${x},${y},${w},${h}`;
  const texture = scene.textures.get(sheet);
  if (!texture.has(name)) texture.add(name, 0, x * 16, y * 16, w * 16, h * 16);
  return name;
}

export function itemFrame(
  scene: Phaser.Scene,
  spriteKey: string,
): { sheet: string; frame: string; rect: SpriteRect } | null {
  const rect = parseSpriteKey(spriteKey);
  if (!rect) return null;
  return {
    sheet: rect.sheet,
    frame: tileFrame(scene, rect.sheet, rect.x, rect.y, rect.w, rect.h),
    rect,
  };
}
