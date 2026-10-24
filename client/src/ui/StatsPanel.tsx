import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../net/supabase';
import { uiStore, useUi } from '../store';

interface Stats {
  coins: number;
  totalFocusMin: number;
  streakDays: number;
  longestStreak: number;
  bestDayMin: number;
  daysFocused: number;
  sessionsCompleted: number;
  sessionsTotal: number;
  coinsEarned: number;
  coinsSpent: number;
}

interface Day {
  day: string; // YYYY-MM-DD (UTC)
  minutes: number;
  coins: number;
}

const WEEKS = 26;
/**
 * Sequential blue ramp (reference palette), stepped for the light paper panel: no focus
 * recedes into the panel, more minutes get darker.
 */
const HEAT = [
  { min: 0, color: 'rgba(75, 53, 39, 0.08)', label: 'none' },
  { min: 1, color: '#b7d3f6', label: '1–24 min' },
  { min: 25, color: '#6da7ec', label: '25–59 min' },
  { min: 60, color: '#2a78d6', label: '1–2 h' },
  { min: 120, color: '#184f95', label: '2 h+' },
];
const BAR = '#2a78d6';

const heatColor = (minutes: number) => [...HEAT].reverse().find((h) => minutes >= h.min)!.color;
const hm = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const label = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function Tile({ value, caption }: { value: ReactNode; caption: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-caption">{caption}</div>
    </div>
  );
}

interface Tip {
  x: number;
  y: number;
  text: string;
}

/** Minutes per day, last 14 days. One series, so the title names it and there's no legend. */
function DailyBars({ days, onTip }: { days: Day[]; onTip: (t: Tip | null) => void }) {
  const W = 420;
  const H = 120;
  const pad = { l: 28, b: 18, t: 6 };
  const max = Math.max(60, ...days.map((d) => d.minutes));
  const top = Math.ceil(max / 60) * 60;
  const slot = (W - pad.l) / days.length;
  const bw = Math.max(6, slot - 6);
  const y = (m: number) => H - pad.b - (m / top) * (H - pad.b - pad.t);
  const grid = [0, top / 2, top];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Focus minutes per day, last 14 days"
    >
      {grid.map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W} y1={y(g)} y2={y(g)} className="grid" />
          <text x={pad.l - 4} y={y(g) + 3} className="axis" textAnchor="end">
            {g >= 60 ? `${g / 60}h` : g}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        const h = Math.max(0, y(0) - y(d.minutes));
        const r = Math.min(4, bw / 2, h);
        return (
          <g key={d.day}>
            {h > 0 && (
              // Rounded data end at the top, square at the baseline.
              <path
                d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + bw - r} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r} V${y(0)} Z`}
                fill={BAR}
              />
            )}
            {i % 2 === days.length % 2 && (
              <text x={x + bw / 2} y={H - 5} className="axis" textAnchor="middle">
                {Number(d.day.slice(8))}
              </text>
            )}
            {/* Hit target wider and taller than the mark. */}
            <rect
              x={pad.l + i * slot}
              y={pad.t}
              width={slot}
              height={H - pad.b - pad.t}
              fill="transparent"
              onMouseMove={(e) =>
                onTip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${label(d.day)} · ${hm(d.minutes)} · ${d.coins} coins`,
                })
              }
              onMouseLeave={() => onTip(null)}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** GitHub-style streak calendar: one column per week (Mon–Sun), UTC days. */
function Calendar({
  byDay,
  todayIso,
  onTip,
}: {
  byDay: Map<string, Day>;
  todayIso: string;
  onTip: (t: Tip | null) => void;
}) {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - dow - (WEEKS - 1) * 7,
    ),
  );
  const cells: { iso: string; col: number; row: number }[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = isoDay(d);
    if (iso > todayIso) break;
    cells.push({ iso, col: Math.floor(i / 7), row: i % 7 });
  }
  const C = 11;
  const G = 2;
  return (
    <svg
      viewBox={`0 0 ${WEEKS * (C + G) + 18} ${7 * (C + G)}`}
      className="chart calendar"
      role="img"
      aria-label={`Focus calendar, last ${WEEKS} weeks`}
    >
      {['M', 'W', 'F'].map((d, i) => (
        <text key={d} x={0} y={(i * 2 + 1) * (C + G) - 2} className="axis">
          {d}
        </text>
      ))}
      {cells.map((c) => {
        const m = byDay.get(c.iso)?.minutes ?? 0;
        return (
          <rect
            key={c.iso}
            x={18 + c.col * (C + G)}
            y={c.row * (C + G)}
            width={C}
            height={C}
            rx={2}
            fill={heatColor(m)}
            className={c.iso === todayIso ? 'today' : undefined}
            onMouseMove={(e) =>
              onTip({
                x: e.clientX,
                y: e.clientY,
                text: `${label(c.iso)} · ${m ? hm(m) : 'no focus'}`,
              })
            }
            onMouseLeave={() => onTip(null)}
          />
        );
      })}
    </svg>
  );
}

/** Your focus stats: totals, streaks, the last two weeks and a half-year calendar. */
export function StatsPanel() {
  const open = useUi((s) => s.statsOpen);
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /** UTC day the stats were loaded on (kept out of render so rendering stays pure). */
  const [todayIso, setTodayIso] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const since = isoDay(new Date(Date.now() - (WEEKS * 7 + 7) * 86_400_000));
    Promise.all([
      supabase.rpc('my_stats'),
      supabase.from('focus_daily').select('day, minutes, coins').gte('day', since).order('day'),
    ])
      .then(([s, d]) => {
        if (cancelled) return;
        if (s.error || d.error) throw new Error((s.error ?? d.error)!.message);
        setStats(s.data as Stats);
        setDays(d.data as Day[]);
        setTodayIso(isoDay(new Date()));
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const last14 = useMemo(() => {
    const out: Day[] = [];
    if (!todayIso) return out;
    const today = Date.parse(`${todayIso}T00:00:00Z`);
    for (let i = 13; i >= 0; i--) {
      const iso = isoDay(new Date(today - i * 86_400_000));
      out.push(byDay.get(iso) ?? { day: iso, minutes: 0, coins: 0 });
    }
    return out;
  }, [byDay, todayIso]);

  if (!open) return null;
  const close = () => uiStore.set({ statsOpen: false });

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card stats" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <h2 className="title">Your focus</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {error && <div className="form-error">{error}</div>}
        {!stats && !error && <div className="spinner" aria-label="Loading" />}
        {stats && (
          <>
            <div className="stat-tiles">
              <Tile value={hm(stats.totalFocusMin)} caption="total focus" />
              <Tile value={`${stats.streakDays} 🔥`} caption="day streak" />
              <Tile value={stats.longestStreak} caption="longest streak" />
              <Tile value={stats.daysFocused} caption="days focused" />
              <Tile value={hm(stats.bestDayMin)} caption="best day" />
              <Tile
                value={`${stats.sessionsCompleted}/${stats.sessionsTotal}`}
                caption="sessions completed"
              />
              <Tile value={stats.coinsEarned.toLocaleString()} caption="coins earned" />
              <Tile value={stats.coinsSpent.toLocaleString()} caption="coins spent" />
            </div>

            <h3 className="drawer-group">Minutes per day · last 14 days</h3>
            <DailyBars days={last14} onTip={setTip} />

            <h3 className="drawer-group">Streak calendar · last {WEEKS} weeks (UTC days)</h3>
            <Calendar byDay={byDay} todayIso={todayIso} onTip={setTip} />
            <div className="heat-legend">
              <span>less</span>
              {HEAT.map((h) => (
                <span
                  key={h.min}
                  className="heat-swatch"
                  style={{ background: h.color }}
                  title={h.label}
                />
              ))}
              <span>more</span>
            </div>

            <details className="table-view">
              <summary>Show as a table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Day (UTC)</th>
                    <th>Focus</th>
                    <th>Coins</th>
                  </tr>
                </thead>
                <tbody>
                  {[...last14].reverse().map((d) => (
                    <tr key={d.day}>
                      <td>{label(d.day)}</td>
                      <td>{hm(d.minutes)}</td>
                      <td>{d.coins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
        {tip && (
          <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y - 30 }}>
            {tip.text}
          </div>
        )}
      </div>
    </div>
  );
}
