import type Phaser from 'phaser';
import { AVATAR_COUNT, DIRECTIONS, type Direction } from '@focus-town/shared';

export const CHARACTERS_KEY = 'characters';

/**
 * characters.png layout: 4 columns (down, up, left, right) × 18 rows.
 * Each avatar uses 3 consecutive rows: idle, walk A, walk B.
 */
export function characterFrame(avatar: number, row: 0 | 1 | 2, dir: Direction): number {
  return (avatar * 3 + row) * 4 + DIRECTIONS.indexOf(dir);
}

export const walkAnimKey = (avatar: number, dir: Direction) => `walk-${avatar}-${dir}`;

export function createCharacterAnims(anims: Phaser.Animations.AnimationManager): void {
  for (let avatar = 0; avatar < AVATAR_COUNT; avatar++) {
    for (const dir of DIRECTIONS) {
      anims.create({
        key: walkAnimKey(avatar, dir),
        frames: ([1, 0, 2, 0] as const).map((row) => ({
          key: CHARACTERS_KEY,
          frame: characterFrame(avatar, row, dir),
        })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }
}
