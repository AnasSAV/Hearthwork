import { describe, expect, it } from 'vitest';
import {
  applyBeat,
  completionBonus,
  confirmPresence,
  createTracker,
  missedBeats,
  type Beat,
  type FocusTracker,
} from './focus.js';

const MIN = 60_000;
const good: Beat = { visible: true, lastInputAgoSec: 5 };

/** Send `count` on-time beats, one per minute. */
function beatMinutes(t: FocusTracker, count: number, beat: Beat = good): FocusTracker {
  let tracker = t;
  for (let i = 0; i < count; i++) {
    tracker = applyBeat(tracker, beat, tracker.lastBeatAt + MIN).tracker;
  }
  return tracker;
}

describe('applyBeat', () => {
  it('counts an on-time, visible, active minute', () => {
    const { tracker, outcome } = applyBeat(createTracker(0, 25, false), good, MIN);
    expect(outcome).toEqual({ kind: 'counted' });
    expect(tracker.verifiedMin).toBe(1);
  });

  it('ignores beats faster than every 50 s', () => {
    const t = createTracker(0, null, false);
    const { tracker, outcome } = applyBeat(t, good, 49_000);
    expect(outcome).toEqual({ kind: 'ignored', reason: 'too_soon' });
    expect(tracker).toBe(t);
  });

  it('does not count a late beat, but accepts it as the new baseline', () => {
    const { tracker, outcome } = applyBeat(createTracker(0, null, false), good, 81_000);
    expect(outcome).toEqual({ kind: 'not_counted', reason: 'late' });
    expect(tracker.verifiedMin).toBe(0);
    expect(tracker.lastBeatAt).toBe(81_000);
    // The next on-time beat counts again.
    expect(applyBeat(tracker, good, 81_000 + MIN).outcome.kind).toBe('counted');
  });

  it('does not count a hidden tab unless audio-only mode is on', () => {
    const hidden = { visible: false, lastInputAgoSec: 5 };
    expect(applyBeat(createTracker(0, null, false), hidden, MIN).outcome).toEqual({
      kind: 'not_counted',
      reason: 'hidden',
    });
    expect(applyBeat(createTracker(0, null, true), hidden, MIN).outcome.kind).toBe('counted');
  });

  it('requires input within the last 10 minutes', () => {
    const t = createTracker(0, null, false);
    expect(applyBeat(t, { visible: true, lastInputAgoSec: 600 }, MIN).outcome.kind).toBe('counted');
    expect(applyBeat(t, { visible: true, lastInputAgoSec: 601 }, MIN).outcome).toEqual({
      kind: 'not_counted',
      reason: 'idle',
    });
  });

  it('never verifies more minutes than have elapsed', () => {
    // Beats every 50 s would otherwise earn 6 minutes in 5 minutes.
    let t = createTracker(0, null, false);
    for (let now = 50_000; now <= 300_000; now += 50_000) t = applyBeat(t, good, now).tracker;
    expect(t.verifiedMin).toBeLessThanOrEqual(5);
  });
});

describe('presence check', () => {
  it('asks "still here?" after 25 verified minutes and blocks minutes until answered', () => {
    let t = beatMinutes(createTracker(0, 50, false), 25);
    expect(t.verifiedMin).toBe(25);
    expect(t.awaitingPresence).toBe(true);

    const blocked = applyBeat(t, good, t.lastBeatAt + MIN);
    expect(blocked.outcome).toEqual({ kind: 'not_counted', reason: 'presence_pending' });

    t = confirmPresence(blocked.tracker);
    expect(applyBeat(t, good, t.lastBeatAt + MIN).outcome.kind).toBe('counted');
  });

  it('does not prompt when a 25-minute block just finished', () => {
    const t = beatMinutes(createTracker(0, 25, false), 25);
    expect(t.awaitingPresence).toBe(false);
  });
});

describe('missedBeats', () => {
  it('counts a beat as missed once it is later than the late window', () => {
    const t = createTracker(0, null, false);
    expect(missedBeats(t, 79_000)).toBe(0);
    expect(missedBeats(t, 80_000)).toBe(1);
    expect(missedBeats(t, 140_000)).toBe(2);
    expect(missedBeats(t, 200_000)).toBe(3);
  });
});

describe('completionBonus', () => {
  it('pays 5 for a finished 25-minute block and 12 for a 50-minute block', () => {
    expect(completionBonus(beatMinutes(createTracker(0, 25, false), 25))).toBe(5);
    let fifty = beatMinutes(createTracker(0, 50, false), 25);
    fifty = beatMinutes(confirmPresence(fifty), 25);
    expect(fifty.verifiedMin).toBe(50);
    expect(completionBonus(fifty)).toBe(12);
  });

  it('pays nothing for unfinished or open-ended sessions', () => {
    expect(completionBonus(beatMinutes(createTracker(0, 25, false), 24))).toBe(0);
    expect(completionBonus(beatMinutes(createTracker(0, null, false), 30))).toBe(0);
  });
});
