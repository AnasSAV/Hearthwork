import type Phaser from 'phaser';

/** LimeZu UI atlas (tools/art/build_ui.py): emote bubbles, timer bubble, typing dots. */
export const UI_KEY = 'ui';

export function loadUiAtlas(load: Phaser.Loader.LoaderPlugin): void {
  load.atlas(UI_KEY, 'ui/ui.png', 'ui/ui.json');
}

/** `ui:timer` (focusing) and `ui:typing` (chatting) bubble animations. */
export function ensureUiAnims(scene: Phaser.Scene): void {
  const frames = (name: string) =>
    Array.from({ length: 8 }, (_, i) => ({ key: UI_KEY, frame: `${name}:${i}` }));
  if (!scene.anims.exists('ui:timer')) {
    scene.anims.create({ key: 'ui:timer', frames: frames('timer'), frameRate: 2, repeat: -1 });
  }
  if (!scene.anims.exists('ui:typing')) {
    scene.anims.create({ key: 'ui:typing', frames: frames('typing'), frameRate: 8, repeat: -1 });
  }
}
