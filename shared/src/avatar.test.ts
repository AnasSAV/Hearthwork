import { describe, expect, it } from 'vitest';
import {
  avatarFrame,
  avatarSchema,
  avatarSitFrame,
  decodeAvatar,
  DEFAULT_AVATAR,
  encodeAvatar,
  parseAvatar,
  partStyles,
  randomAvatar,
} from './avatar.js';

describe('avatars', () => {
  it('round-trips through the compact PlayerState encoding', () => {
    const a = { v: 2, body: 3, eyes: 6, outfit: 131, hair: 199, acc: -1 } as const;
    expect(decodeAvatar(encodeAvatar(a))).toEqual(a);
    expect(decodeAvatar('garbage')).toEqual(DEFAULT_AVATAR);
  });

  it('rejects old and out-of-range avatars', () => {
    expect(parseAvatar({ body: 3 })).toBeNull();
    expect(parseAvatar({ ...DEFAULT_AVATAR, hair: 200 })).toBeNull();
    expect(parseAvatar({ ...DEFAULT_AVATAR, acc: -2 })).toBeNull();
    for (let i = 0; i < 50; i++) expect(avatarSchema.safeParse(randomAvatar()).success).toBe(true);
  });

  it('groups parts into styles with colour variants', () => {
    const hair = partStyles('hair');
    expect(hair[0]).toEqual({ name: 'Style 1', variants: [0, 1, 2, 3, 4, 5, 6] });
    expect(partStyles('acc').map((s) => s.name)).toContain('Backpack');
    expect(partStyles('body')).toHaveLength(1);
  });

  it('lays out frames as idle, walk, sit rows', () => {
    expect(avatarFrame('idle', 'right', 0)).toBe(0);
    expect(avatarFrame('idle', 'down', 5)).toBe(23);
    expect(avatarFrame('walk', 'up', 0)).toBe(30);
    expect(avatarSitFrame('left', 0)).toBe(54);
  });
});
