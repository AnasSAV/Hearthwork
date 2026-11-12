import {
  COMPLETION_BONUS,
  FOCUS_BEAT_INTERVAL_MS,
  FOCUS_BEAT_LATE_MS,
  FOCUS_BEAT_MIN_INTERVAL_MS,
  FOCUS_MAX_INPUT_IDLE_SEC,
  FOCUS_PRESENCE_EVERY_MIN,
  FOCUS_PRESENCE_GRACE_MIN,
  type FocusBlock,
} from './constants.js';

/**
 * Server-side state of one focus session's verification. Pure data: the server owns the clock
 * and passes `now` in, which keeps these rules deterministic and unit-testable.
 */
export interface FocusTracker {
  /** Server time (ms) when the session started. */
  startedAt: number;
  /** Server time (ms) of the last accepted beat, or of the start. */
  lastBeatAt: number;
  plannedMin: FocusBlock | null;
  verifiedMin: number;
  /** Verified minutes since the player last proved they're present (start or "still here?"). */
  minutesSincePresence: number;
  /** A "still here?" prompt is open; minutes stop counting if it goes unanswered too long. */
  awaitingPresence: boolean;
}

export interface Beat {
  /** The game window is in front and focused, so the browser can see the player's input. */
  inGame: boolean;
  lastInputAgoSec: number;
}

export type BeatOutcome =
  | { kind: 'ignored'; reason: 'too_soon' }
  | { kind: 'counted' }
  | {
      kind: 'not_counted';
      reason: 'late' | 'presence_pending' | 'idle' | 'ahead_of_clock';
    };

export function createTracker(now: number, plannedMin: FocusBlock | null): FocusTracker {
  return {
    startedAt: now,
    lastBeatAt: now,
    plannedMin,
    verifiedMin: 0,
    minutesSincePresence: 0,
    awaitingPresence: false,
  };
}

/** The "still here?" question went unanswered past its grace period: the timer is paused. */
export function isPresencePaused(t: FocusTracker): boolean {
  return (
    t.awaitingPresence &&
    t.minutesSincePresence >= FOCUS_PRESENCE_EVERY_MIN + FOCUS_PRESENCE_GRACE_MIN
  );
}

/**
 * Decide whether a heartbeat verifies one more minute. A minute counts only if the beat
 * arrived on time, the timer isn't paused by an unanswered "still here?", the player had input
 * recently if the game window is the one in front (working in another window is the point, and
 * the browser can't see input there), and the session is old enough to have that many minutes.
 */
export function applyBeat(
  t: FocusTracker,
  beat: Beat,
  now: number,
): { tracker: FocusTracker; outcome: BeatOutcome } {
  const sinceLast = now - t.lastBeatAt;
  if (sinceLast < FOCUS_BEAT_MIN_INTERVAL_MS) {
    return { tracker: t, outcome: { kind: 'ignored', reason: 'too_soon' } };
  }
  const next = { ...t, lastBeatAt: now };
  const notCounted = (reason: Extract<BeatOutcome, { kind: 'not_counted' }>['reason']) => ({
    tracker: next,
    outcome: { kind: 'not_counted', reason } as const,
  });

  if (sinceLast > FOCUS_BEAT_LATE_MS) return notCounted('late');
  if (isPresencePaused(t)) return notCounted('presence_pending');
  if (beat.inGame && beat.lastInputAgoSec > FOCUS_MAX_INPUT_IDLE_SEC) return notCounted('idle');
  // Never verify more minutes than have elapsed (10 s slack for network jitter).
  const elapsedMin = Math.floor((now - t.startedAt + 10_000) / 60_000);
  if (t.verifiedMin + 1 > elapsedMin) return notCounted('ahead_of_clock');

  next.verifiedMin += 1;
  next.minutesSincePresence += 1;
  if (next.minutesSincePresence >= FOCUS_PRESENCE_EVERY_MIN && !isBlockComplete(next)) {
    next.awaitingPresence = true;
  }
  return { tracker: next, outcome: { kind: 'counted' } };
}

/** Player answered the "still here?" prompt. */
export function confirmPresence(t: FocusTracker): FocusTracker {
  return { ...t, awaitingPresence: false, minutesSincePresence: 0 };
}

/** Beats missed since the last accepted one (a beat is "missed" once it's later than LATE). */
export function missedBeats(t: FocusTracker, now: number): number {
  const overdue = now - t.lastBeatAt - (FOCUS_BEAT_LATE_MS - FOCUS_BEAT_INTERVAL_MS);
  return Math.max(0, Math.floor(overdue / FOCUS_BEAT_INTERVAL_MS));
}

export function isBlockComplete(t: FocusTracker): boolean {
  return t.plannedMin !== null && t.verifiedMin >= t.plannedMin;
}

/** Completion bonus owed when the session closes. */
export function completionBonus(t: FocusTracker): number {
  return t.plannedMin !== null && isBlockComplete(t) ? COMPLETION_BONUS[t.plannedMin] : 0;
}
