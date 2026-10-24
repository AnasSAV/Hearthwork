import { useEffect, useState } from 'react';

export function useTick(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

function Digital({ now, seconds, twelve }: { now: Date; seconds: boolean; twelve: boolean }) {
  const h = twelve ? now.getHours() % 12 || 12 : now.getHours();
  return (
    <div className="clock-digital">
      <span className="clock-time">
        {pad(h)}
        <span className={now.getSeconds() % 2 ? 'blink off' : 'blink'}>:</span>
        {pad(now.getMinutes())}
        {seconds && <small>:{pad(now.getSeconds())}</small>}
        {twelve && <small className="ampm">{now.getHours() < 12 ? 'am' : 'pm'}</small>}
      </span>
      {seconds && (
        <span className="clock-date">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      )}
    </div>
  );
}

/** Analog face; `railway` is the station clock with bold ticks and a red seconds hand. */
function Analog({ now, railway }: { now: Date; railway: boolean }) {
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  const hand = (deg: number, len: number, width: number, color: string, tail = 0) => (
    <line
      x1={50 - Math.sin((deg * Math.PI) / 180) * tail}
      y1={50 + Math.cos((deg * Math.PI) / 180) * tail}
      x2={50 + Math.sin((deg * Math.PI) / 180) * len}
      y2={50 - Math.cos((deg * Math.PI) / 180) * len}
      stroke={color}
      strokeWidth={width}
      strokeLinecap={railway ? 'butt' : 'round'}
    />
  );
  return (
    <svg className="clock-analog" viewBox="0 0 100 100" aria-label={now.toLocaleTimeString()}>
      <circle cx="50" cy="50" r="47" fill="#fffdf6" stroke="#4b3527" strokeWidth="3" />
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        if (!railway && !major) return null;
        const a = (i * 6 * Math.PI) / 180;
        const r1 = railway ? (major ? 33 : 40) : 41;
        const r2 = railway ? 44 : 44;
        return (
          <line
            key={i}
            x1={50 + Math.sin(a) * r1}
            y1={50 - Math.cos(a) * r1}
            x2={50 + Math.sin(a) * r2}
            y2={50 - Math.cos(a) * r2}
            stroke={railway ? '#2b211b' : '#79b48c'}
            strokeWidth={railway ? (major ? 4 : 1.4) : 2.4}
            strokeLinecap="round"
          />
        );
      })}
      {!railway &&
        [12, 3, 6, 9].map((n) => {
          const a = (n * 30 * Math.PI) / 180;
          return (
            <text
              key={n}
              x={50 + Math.sin(a) * 31}
              y={50 - Math.cos(a) * 31 + 5}
              textAnchor="middle"
              fontSize="13"
              fontWeight="900"
              fill="#4b3527"
            >
              {n}
            </text>
          );
        })}
      {hand(h * 30, 24, railway ? 6 : 5, '#2b211b', railway ? 8 : 0)}
      {hand(m * 6, 36, railway ? 4 : 3.5, '#2b211b', railway ? 8 : 0)}
      {hand(s * 6, railway ? 32 : 38, 1.4, railway ? '#d62f2f' : '#f08a24', railway ? 10 : 6)}
      {railway && (
        <circle
          cx={50 + Math.sin((s * 6 * Math.PI) / 180) * 32}
          cy={50 - Math.cos((s * 6 * Math.PI) / 180) * 32}
          r="4.5"
          fill="#d62f2f"
        />
      )}
      <circle cx="50" cy="50" r="2.6" fill="#fffdf6" stroke="#2b211b" strokeWidth="1.5" />
    </svg>
  );
}

export const CLOCK_VARIANTS = [
  { id: 'digital', name: 'Digital clock', hint: 'Click to switch 12/24 hours' },
  { id: 'digital-seconds', name: 'Big digital', hint: 'With seconds and the date' },
  { id: 'analog', name: 'Analog clock', hint: 'A friendly clock face' },
  { id: 'railway', name: 'Railway clock', hint: 'Station clock, red seconds hand' },
] as const;

export function ClockWidget({
  variant,
  onVariant,
}: {
  variant: string;
  onVariant?: (v: string) => void;
}) {
  const [base, mode] = variant.split(':');
  const now = useTick(1000);
  if (base === 'analog' || base === 'railway')
    return <Analog now={now} railway={base === 'railway'} />;
  const face = <Digital now={now} seconds={base === 'digital-seconds'} twelve={mode === '12'} />;
  // In the picker's preview (no handler) it's a plain picture, not a nested button.
  if (!onVariant) return face;
  return (
    <button
      type="button"
      className="clock-btn"
      title="Switch 12/24 hours"
      onClick={() => onVariant(`${base}:${mode === '12' ? '24' : '12'}`)}
    >
      {face}
    </button>
  );
}
