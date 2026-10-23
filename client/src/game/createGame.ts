import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { TownScene } from '../scenes/TownScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    backgroundColor: '#1d1b2a',
    pixelArt: true,
    // Phaser 4 defaults roundPixels to false; pixel art wants whole-pixel positions.
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    scene: [BootScene, TownScene],
  });
  // Dev-only handle for debugging and browser tests; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
  return game;
}
