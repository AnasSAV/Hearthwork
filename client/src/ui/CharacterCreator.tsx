import { useEffect, useMemo, useState } from 'react';
import {
  AVATAR_ANIM_FRAMES,
  AVATAR_PART_COLORS,
  partStyles,
  randomAvatar,
  type Avatar,
  type AvatarPart,
  type Direction,
} from '@focus-town/shared';
import { AvatarSprite } from './AvatarSprite';

/** Turning order for the preview's rotate buttons (clockwise seen from above). */
const TURN: Direction[] = ['down', 'left', 'up', 'right'];

function Swatches({
  part,
  indices,
  value,
  onPick,
}: {
  part: AvatarPart;
  indices: number[];
  value: number;
  onPick: (index: number) => void;
}) {
  return (
    <div className="swatches">
      {indices.map((i, n) => (
        <button
          key={i}
          type="button"
          className={`swatch${i === value ? ' selected' : ''}`}
          style={{ background: AVATAR_PART_COLORS[part][i] }}
          onClick={() => onPick(i)}
          aria-label={`Colour ${n + 1}`}
          aria-pressed={i === value}
        />
      ))}
    </div>
  );
}

/** A part with styles (outfit, hair, accessory): style stepper plus its colour variants. */
function StyledPart({
  label,
  part,
  value,
  optional = false,
  onPick,
}: {
  label: string;
  part: AvatarPart;
  value: number;
  optional?: boolean;
  onPick: (index: number) => void;
}) {
  const styles = useMemo(() => partStyles(part), [part]);
  const current = styles.findIndex((s) => s.variants.includes(value));
  // Optional parts get a "None" slot before the first style (index -1 in the cycle).
  const first = optional ? -1 : 0;
  const step = (delta: number) => {
    const count = styles.length - first;
    const next = ((current - first + delta + count) % count) + first;
    if (next < 0) return onPick(-1);
    const shade = current >= 0 ? styles[current]!.variants.indexOf(value) : 0;
    const variants = styles[next]!.variants;
    onPick(variants[Math.min(shade, variants.length - 1)]!);
  };
  return (
    <div className="creator-row">
      <span className="creator-label">{label}</span>
      <div className="stepper">
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          aria-label={`Previous ${label.toLowerCase()}`}
        >
          ‹
        </button>
        <span className="stepper-value">
          {current < 0 ? 'None' : styles[current]!.name}
          <small>{current < 0 ? '' : ` ${current + 1}/${styles.length}`}</small>
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(1)}
          aria-label={`Next ${label.toLowerCase()}`}
        >
          ›
        </button>
      </div>
      {current >= 0 && styles[current]!.variants.length > 1 && (
        <Swatches part={part} indices={styles[current]!.variants} value={value} onPick={onPick} />
      )}
    </div>
  );
}

/** Layered character editor with an animated, turnable preview. */
export function CharacterCreator({
  value,
  onChange,
}: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}) {
  const [turn, setTurn] = useState(0);
  const [walking, setWalking] = useState(true);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (f + 1) % AVATAR_ANIM_FRAMES), 140);
    return () => window.clearInterval(id);
  }, []);
  const set = (part: AvatarPart) => (index: number) => onChange({ ...value, [part]: index });
  const all = (part: AvatarPart) => partStyles(part).flatMap((s) => s.variants);

  return (
    <div className="creator">
      <div className="creator-preview">
        <div className="creator-stage">
          <AvatarSprite
            avatar={value}
            scale={6}
            dir={TURN[turn]}
            anim={walking ? 'walk' : 'idle'}
            frame={frame}
          />
        </div>
        <div className="creator-tools">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTurn((t) => (t + 3) % 4)}
            aria-label="Turn left"
          >
            ↺
          </button>
          <button type="button" className="link" onClick={() => setWalking((w) => !w)}>
            {walking ? 'Stand' : 'Walk'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTurn((t) => (t + 1) % 4)}
            aria-label="Turn right"
          >
            ↻
          </button>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChange(randomAvatar())}
        >
          Shuffle
        </button>
      </div>
      <div className="creator-parts">
        <div className="creator-row">
          <span className="creator-label">Skin</span>
          <Swatches part="body" indices={all('body')} value={value.body} onPick={set('body')} />
        </div>
        <div className="creator-row">
          <span className="creator-label">Eyes</span>
          <Swatches part="eyes" indices={all('eyes')} value={value.eyes} onPick={set('eyes')} />
        </div>
        <StyledPart label="Hair" part="hair" value={value.hair} onPick={set('hair')} />
        <StyledPart label="Outfit" part="outfit" value={value.outfit} onPick={set('outfit')} />
        <StyledPart label="Extra" part="acc" value={value.acc} optional onPick={set('acc')} />
      </div>
    </div>
  );
}
