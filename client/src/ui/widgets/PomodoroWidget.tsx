import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import { Icon } from '../Icon';
import { loadValue, saveValue } from './store';

/**
 * A personal Pomodoro timer: focus, short break, long break, with a cycle count (every 4th
 * break is a long one). It's just a timer for pacing yourself; coins come from verified focus
 * at a desk, which runs separately.
 */
type Mode = 'focus' | 'short' | 'long';

const LENGTHS: Record<string, Record<Mode, number>> = {
  default: { focus: 25, short: 5, long: 15 },
  long: { focus: 50, short: 10, long: 20 },
};
const LABEL: Record<Mode, string> = { focus: 'Pomodoro', short: 'Short break', long: 'Long break' };

interface Saved {
  mode: Mode;
  /** ms timestamp the running timer ends at, or null when paused. */
  endsAt: number | null;
  /** Seconds left while paused. */
  left: number;
  cycle: number;
}

export const POMODORO_VARIANTS = [
  { id: 'default', name: 'Classic', hint: '25 min focus, 5 / 15 min breaks' },
  { id: 'long', name: 'Deep work', hint: '50 min focus, 10 / 20 min breaks' },
] as const;

const fmt = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function PomodoroWidget({ id, variant }: { id: string; variant: string }) {
  const lengths = LENGTHS[variant] ?? LENGTHS.default!;
  const [saved, setSaved] = useState<Saved>(() =>
    loadValue<Saved>(id, { mode: 'focus', endsAt: null, left: lengths.focus * 60, cycle: 1 }),
  );
  const [now, setNow] = useState(() => Date.now());
  const current = useRef(saved);

  useEffect(() => {
    current.current = saved;
    saveValue(id, saved);
  }, [id, saved]);

  // Tick while running; when time is up, chime and move on to the next step (paused).
  useEffect(() => {
    if (!saved.endsAt) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const s = current.current;
      if (!s.endsAt || s.endsAt > n) return;
      sfx.play('chime');
      const next: Mode = s.mode !== 'focus' ? 'focus' : s.cycle % 4 === 0 ? 'long' : 'short';
      setSaved({
        mode: next,
        endsAt: null,
        left: lengths[next] * 60,
        cycle: s.mode !== 'focus' ? (s.cycle % 4) + 1 : s.cycle,
      });
    }, 250);
    return () => clearInterval(t);
  }, [saved.endsAt, lengths]);

  const left = saved.endsAt ? Math.max(0, (saved.endsAt - now) / 1000) : saved.left;
  const total = lengths[saved.mode] * 60;

  const pick = (mode: Mode) =>
    setSaved((s) => ({ ...s, mode, endsAt: null, left: lengths[mode] * 60 }));
  const toggle = () => {
    sfx.play('click');
    setNow(Date.now());
    setSaved((s) =>
      s.endsAt
        ? { ...s, endsAt: null, left: Math.max(0, (s.endsAt - Date.now()) / 1000) }
        : { ...s, endsAt: Date.now() + s.left * 1000 },
    );
  };
  const reset = () => setSaved((s) => ({ ...s, endsAt: null, left: lengths[s.mode] * 60 }));

  return (
    <div className={`pomodoro ${saved.mode}`}>
      <div className="pomo-modes">
        {(['focus', 'short', 'long'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={saved.mode === m ? 'selected' : ''}
            onClick={() => pick(m)}
          >
            {LABEL[m]}
          </button>
        ))}
      </div>
      <div className="pomo-main">
        <span className="pomo-time">{fmt(left)}</span>
        <button
          type="button"
          className="round-btn"
          aria-label={saved.endsAt ? 'Pause' : 'Start'}
          onClick={toggle}
        >
          <Icon name={saved.endsAt ? 'pause' : 'play'} size={16} />
        </button>
      </div>
      <div className="pomo-bar">
        <span style={{ width: `${Math.min(100, (1 - left / total) * 100)}%` }} />
      </div>
      <div className="pomo-foot">
        <span>Cycle {saved.cycle}/4</span>
        <button type="button" className="link" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
