import type Phaser from 'phaser';
import {
  AVATAR_ANIM_FRAMES,
  AVATAR_ATLAS,
  AVATAR_FRAME_H,
  AVATAR_FRAME_W,
  AVATAR_PARTS,
  DIRECTIONS,
  avatarCell,
  avatarFrame,
  decodeAvatar,
  type Direction,
} from '@focus-town/shared';

/** Texture key of a part atlas (client/public/assets/characters/<part>.png). */
export const partAtlasKey = (part: string) => `avatar-${part}`;

export function loadCharacterAtlases(load: Phaser.Loader.LoaderPlugin): void {
  for (const part of AVATAR_PARTS) load.image(partAtlasKey(part), `characters/${part}.png`);
}

const textureKey = (code: string) => `avatar:${code}`;
export const idleAnimKey = (code: string, dir: Direction) => `idle:${code}:${dir}`;
export const walkAnimKey = (code: string, dir: Direction) => `walk:${code}:${dir}`;

/**
 * Composite an avatar's layers into its own sprite sheet (idle, walk and sit rows of 16x32
 * frames) and create its animations. Players with the same look share one texture.
 * Returns the texture key; frame numbers follow avatarFrame()/avatarSitFrame().
 */
export function ensureAvatarTexture(scene: Phaser.Scene, code: string): string {
  const key = textureKey(code);
  if (scene.textures.exists(key)) return key;

  const { cellWidth: w, cellHeight: h } = AVATAR_ATLAS;
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) throw new Error(`could not create texture ${key}`);
  const avatar = decodeAvatar(code);
  for (const part of AVATAR_PARTS) {
    const index = avatar[part];
    if (index < 0) continue;
    const { x, y } = avatarCell(part, index);
    const image = scene.textures.get(partAtlasKey(part)).getSourceImage() as CanvasImageSource;
    texture.context.drawImage(image, x, y, w, h, 0, 0, w, h);
  }
  const columns = w / AVATAR_FRAME_W;
  for (let row = 0; row < h / AVATAR_FRAME_H; row++) {
    for (let col = 0; col < columns; col++) {
      texture.add(
        row * columns + col,
        0,
        col * AVATAR_FRAME_W,
        row * AVATAR_FRAME_H,
        AVATAR_FRAME_W,
        AVATAR_FRAME_H,
      );
    }
  }
  texture.refresh();

  const frames = (anim: 'idle' | 'walk', dir: Direction) =>
    Array.from({ length: AVATAR_ANIM_FRAMES }, (_, i) => ({
      key,
      frame: avatarFrame(anim, dir, i),
    }));
  for (const dir of DIRECTIONS) {
    scene.anims.create({
      key: idleAnimKey(code, dir),
      frames: frames('idle', dir),
      frameRate: 6,
      repeat: -1,
    });
    scene.anims.create({
      key: walkAnimKey(code, dir),
      frames: frames('walk', dir),
      frameRate: 10,
      repeat: -1,
    });
  }
  return key;
}
