import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { HouseScene } from '../scenes/HouseScene';
import { TownScene } from '../scenes/TownScene';
import { attachGame } from './navigation';

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
    scene: [BootScene, TownScene, HouseScene],
  });
  attachGame(game);

  // While a text field has focus, Phaser must not grab keys: its global key capture would
  // swallow W/A/S/D/E/I typed into chat or the friends search box.
  const isTextField = (el: EventTarget | null) =>
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable);
  const setKeyboard = (on: boolean) => {
    const keyboard = game.input.keyboard;
    if (!keyboard) return;
    keyboard.enabled = on;
    keyboard.preventDefault = on;
    if (on) for (const scene of game.scene.getScenes(true)) scene.input.keyboard?.resetKeys();
  };
  const onFocusIn = (e: FocusEvent) => isTextField(e.target) && setKeyboard(false);
  const onFocusOut = (e: FocusEvent) => isTextField(e.target) && setKeyboard(true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    attachGame(null);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
  });
  // Dev-only handle for debugging and browser tests; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
  return game;
}
