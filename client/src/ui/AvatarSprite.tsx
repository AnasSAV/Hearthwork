import {
  AVATAR_ATLAS,
  AVATAR_PARTS,
  DEFAULT_AVATAR,
  avatarCell,
  avatarFrame,
  parseAvatar,
  type Direction,
} from '@focus-town/shared';

/** Visible rows of the 16x32 frames: the whole character, or a 16x16 head-and-shoulders crop. */
const CROPS = { full: { top: 5, height: 27 }, head: { top: 7, height: 16 } };

interface Props {
  /** A stored profile avatar; anything else (e.g. an old-format one) shows the default. */
  avatar: unknown;
  scale?: number;
  head?: boolean;
  dir?: Direction;
  anim?: 'idle' | 'walk';
  frame?: number;
}

/** An avatar drawn from the part atlases as stacked CSS backgrounds, scaled up crisply. */
export function AvatarSprite({
  avatar,
  scale = 4,
  head = false,
  dir = 'down',
  anim = 'idle',
  frame = 0,
}: Props) {
  const crop = CROPS[head ? 'head' : 'full'];
  const a = parseAvatar(avatar) ?? DEFAULT_AVATAR;
  const f = avatarFrame(anim, dir, frame);
  const layers = AVATAR_PARTS.filter((part) => a[part] >= 0).map((part) => {
    const cell = avatarCell(part, a[part]);
    const x = cell.x + (f % 24) * 16;
    const y = cell.y + Math.floor(f / 24) * 32 + crop.top;
    return { part, x, y };
  });
  return (
    <span className="avatar-sprite" style={{ width: 16 * scale, height: crop.height * scale }}>
      {layers.map(({ part, x, y }) => (
        <span
          key={part}
          style={{
            backgroundImage: `url('/assets/characters/${part}.png')`,
            backgroundSize: `${AVATAR_ATLAS.cellWidth * AVATAR_ATLAS.columns * scale}px auto`,
            backgroundPosition: `-${x * scale}px -${y * scale}px`,
          }}
        />
      ))}
    </span>
  );
}
