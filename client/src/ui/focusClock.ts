import { useEffect, useState } from 'react';
import { onFocusTick } from '../net/heartbeat';
import { serverNow } from '../net/clock';
import { useUi, type ActiveFocus, type TableTimer } from '../store';

export const fmtClock = (totalSec: number) => {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The time, re-rendering every second. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Like `useNow`, on the session's worker ticks, which keep going in a minimized window. */
function useFocusNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => onFocusTick(() => setNow(Date.now())), []);
  return now;
}

/** The running group-table timer at `tableId`, if any. */
export function useTableTimer(tableId: string | null): TableTimer | null {
  const timer = useUi((s) => (tableId ? s.tables[tableId] : undefined));
  return timer && timer.endsAt > serverNow() ? timer : null;
}

export interface FocusClock {
  /** What the big clock shows: time left in a block, or time so far in an open session. */
  clock: string;
  /** 0–1 around the ring. */
  progress: number;
  /** What's being timed, e.g. "25 min block". */
  label: string;
}

/** The running session's clock, shared by the focus panel and the mini timer. */
export function useFocusClock(focus: ActiveFocus, tableId: string | null): FocusClock {
  const now = useFocusNow();
  const table = useTableTimer(tableId);
  // Seconds the server has verified, plus the minute in progress.
  const inProgress = focus.paused ? 0 : Math.min(60, (now - focus.receivedAt) / 1000);
  const elapsed = focus.verifiedMin * 60 + inProgress;
  // At a group table everyone sees the table's shared countdown.
  const total = table ? table.plannedMin * 60 : focus.plannedMin ? focus.plannedMin * 60 : null;
  const left = table
    ? (table.endsAt - serverNow()) / 1000
    : focus.plannedMin
      ? focus.plannedMin * 60 - elapsed
      : null;
  return {
    clock: fmtClock(left ?? elapsed),
    // Open sessions fill the ring once per 25 minutes.
    progress: total && left !== null ? 1 - left / total : (elapsed % 1500) / 1500,
    label: table
      ? `Table · ${table.seated} seated`
      : focus.plannedMin
        ? `${focus.plannedMin} min block`
        : 'Open session',
  };
}
