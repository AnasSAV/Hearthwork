import { z } from 'zod';
import { AVATAR_ATLAS, AVATAR_PART_COLORS, AVATAR_PART_IDS } from './avatarParts.js';
import type { Direction } from './schemas.js';

/**
 * Avatars are layered from LimeZu's character generator: body (skin), eyes, outfit, hair and an
 * optional accessory, each stored as an index into AVATAR_PART_IDS (-1 = no accessory).
 * Draw order is the order of AVATAR_PARTS. The SQL `update_profile` range checks mirror the
 * part counts, so regenerating the manifest must only ever append parts.
 */
export const AVATAR_PARTS = ['body', 'eyes', 'outfit', 'hair', 'acc'] as const;
export type AvatarPart = (typeof AVATAR_PARTS)[number];

export const AVATAR_VERSION = 2;

const index = (part: AvatarPart, min = 0) =>
  z
    .number()
    .int()
    .min(min)
    .max(AVATAR_PART_IDS[part].length - 1);

export const avatarSchema = z.object({
  v: z.literal(AVATAR_VERSION),
  body: index('body'),
  eyes: index('eyes'),
  outfit: index('outfit'),
  hair: index('hair'),
  acc: index('acc', -1),
});
export type Avatar = z.infer<typeof avatarSchema>;

export const DEFAULT_AVATAR: Avatar = { v: 2, body: 1, eyes: 0, outfit: 0, hair: 0, acc: -1 };

/** A stored profile avatar, or null if it is missing or from the old (pre-v2) format. */
export function parseAvatar(value: unknown): Avatar | null {
  const parsed = avatarSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Compact form synced in PlayerState, e.g. "1.0.12.40.-1". */
export function encodeAvatar(a: Avatar): string {
  return [a.body, a.eyes, a.outfit, a.hair, a.acc].join('.');
}

export function decodeAvatar(code: string): Avatar {
  const [body, eyes, outfit, hair, acc] = code.split('.').map(Number);
  return parseAvatar({ v: AVATAR_VERSION, body, eyes, outfit, hair, acc }) ?? DEFAULT_AVATAR;
}

export function randomAvatar(random: () => number = Math.random): Avatar {
  const pick = (part: AvatarPart) => Math.floor(random() * AVATAR_PART_IDS[part].length);
  return {
    v: 2,
    body: pick('body'),
    eyes: pick('eyes'),
    outfit: pick('outfit'),
    hair: pick('hair'),
    acc: random() < 0.35 ? pick('acc') : -1,
  };
}

/** A style and its colour variants, e.g. hairstyle 4 in 7 colours. */
export interface PartStyle {
  name: string;
  /** Part indices of the colour variants. */
  variants: number[];
}

/** Group a part's ids by style: ids are `<Style>_<NN>`, the last number being the variant. */
export function partStyles(part: AvatarPart): PartStyle[] {
  const styles = new Map<string, PartStyle>();
  AVATAR_PART_IDS[part].forEach((id, i) => {
    const key = id.replace(/_\d+$/, '');
    let style = styles.get(key);
    if (!style) {
      // "Accessory_03_Backpack" -> "Backpack"; "Hairstyle_07" -> "Style 7".
      const words = key.replace(/^[A-Za-z]+(_\d+)?_?/, '').replace(/_/g, ' ');
      const number = /_(\d+)$/.exec(key)?.[1];
      style = { name: words || (number ? `Style ${Number(number)}` : key), variants: [] };
      styles.set(key, style);
    }
    style.variants.push(i);
  });
  return [...styles.values()];
}

// ---------------------------------------------------------------------------------------------
// Sprite sheet layout (see tools/art/build_characters.py)
// ---------------------------------------------------------------------------------------------

export const AVATAR_FRAME_W = 16;
export const AVATAR_FRAME_H = 32;
export const AVATAR_ANIM_FRAMES = 6;
/** Direction order of the idle and walk rows in the source sheets. */
const SHEET_DIRS: readonly Direction[] = ['right', 'up', 'left', 'down'];
const ROW_FRAMES = AVATAR_ANIM_FRAMES * SHEET_DIRS.length;

/** Frame index in one composed avatar sheet (24 frames per row: idle, walk, sit). */
export function avatarFrame(anim: 'idle' | 'walk', dir: Direction, i: number): number {
  return (anim === 'idle' ? 0 : ROW_FRAMES) + SHEET_DIRS.indexOf(dir) * AVATAR_ANIM_FRAMES + i;
}

/** Sitting frames only exist facing left and right. */
export function avatarSitFrame(side: 'left' | 'right', i: number): number {
  return 2 * ROW_FRAMES + (side === 'left' ? AVATAR_ANIM_FRAMES : 0) + i;
}

/** Top-left pixel of a part's cell in its category atlas. */
export function avatarCell(part: AvatarPart, index: number): { x: number; y: number } {
  return {
    x: (index % AVATAR_ATLAS.columns) * AVATAR_ATLAS.cellWidth,
    y: Math.floor(index / AVATAR_ATLAS.columns) * AVATAR_ATLAS.cellHeight,
  };
}

export { AVATAR_ATLAS, AVATAR_PART_COLORS, AVATAR_PART_IDS };
