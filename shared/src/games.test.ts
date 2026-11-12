import { describe, expect, it } from 'vitest';
import { BASE_RATE } from './constants.js';
import {
  bearingTo,
  closePlayMinutes,
  createPlayTracker,
  FISH,
  heatAt,
  PLAY_ACTIONS_PER_MIN,
  PLAY_RATE,
  raftInput,
  raftScore,
  recordPlayAction,
  reelHit,
  reelMarker,
  rollButterfly,
  rollFish,
  rollTreasure,
  treasureScore,
  type PlayTracker,
} from './games.js';

/** `count` actions, 3 s apart, starting at `from`. */
function act(t: PlayTracker, from: number, count: number): PlayTracker {
  let tracker = t;
  for (let i = 0; i < count; i++) tracker = recordPlayAction(tracker, from + i * 3_000);
  return tracker;
}

describe('coins for playing', () => {
  it('pays half of what focus pays', () => {
    expect(PLAY_RATE).toBe(BASE_RATE / 2);
  });

  it('counts a minute with enough actions in it', () => {
    const t = act(createPlayTracker(0), 1_000, PLAY_ACTIONS_PER_MIN);
    const { played, tracker } = closePlayMinutes(t, 60_000);
    expect(played).toBe(1);
    expect(tracker.actions).toBe(0);
    expect(tracker.minuteStartedAt).toBe(60_000);
  });

  it('does not count a minute with too few actions', () => {
    const t = act(createPlayTracker(0), 1_000, PLAY_ACTIONS_PER_MIN - 1);
    expect(closePlayMinutes(t, 60_000).played).toBe(0);
  });

  it('does not close a minute early', () => {
    const t = act(createPlayTracker(0), 1_000, 10);
    expect(closePlayMinutes(t, 59_999).played).toBe(0);
  });

  it('counts rapid-fire actions once', () => {
    let t = createPlayTracker(0);
    for (let ms = 0; ms < 1_900; ms += 10) t = recordPlayAction(t, ms);
    expect(t.actions).toBe(1);
  });

  it('never credits idle minutes after a burst of actions', () => {
    const t = act(createPlayTracker(0), 1_000, 10);
    expect(closePlayMinutes(t, 300_000).played).toBe(1);
  });
});

describe('fishing', () => {
  it('rolls every fish, by weight', () => {
    expect(rollFish(0).id).toBe('minnow');
    expect(rollFish(0.999).id).toBe('goldfin');
    const total = FISH.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBe(100);
  });

  it('bounces the marker between the ends of the bar', () => {
    expect(reelMarker(0, 1000)).toBe(0);
    expect(reelMarker(250, 1000)).toBeCloseTo(0.5);
    expect(reelMarker(500, 1000)).toBeCloseTo(1);
    expect(reelMarker(750, 1000)).toBeCloseTo(0.5);
    expect(reelMarker(1000, 1000)).toBeCloseTo(0);
  });

  it('forgives the time a tap took to arrive, but not more', () => {
    // Marker at 0.5 at 250 ms, leaving a zone that ends at 0.3 at about 150 ms.
    expect(reelHit(100, 1000, 0.1, 0.2)).toBe(true);
    expect(reelHit(250, 1000, 0.1, 0.2)).toBe(true);
    expect(reelHit(450, 1000, 0.1, 0.2)).toBe(false);
  });
});

describe('rafting', () => {
  it('is carried downstream even with no input', () => {
    expect(raftInput({ x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
  });

  it('paddles back against the current, so it can always get out of a pocket', () => {
    const paddling = raftInput({ x: 1, y: -1 });
    expect(paddling.y).toBeLessThan(0);
    expect(paddling.x).toBeGreaterThan(0);
  });

  it('takes 2 seconds off per buoy, and never goes below zero', () => {
    expect(raftScore(40_000, 3)).toBe(34);
    expect(raftScore(1_000, 3)).toBe(0);
  });
});

describe('butterflies', () => {
  it('rolls common ones low and rare ones high', () => {
    expect(rollButterfly(0).id).toBe('white');
    expect(rollButterfly(0.999).id).toBe('gold');
  });
});

describe('treasure', () => {
  it('gets warmer closer in', () => {
    expect(heatAt(10)).toBe('burning');
    expect(heatAt(70)).toBe('hot');
    expect(heatAt(120)).toBe('warm');
    expect(heatAt(200)).toBe('cold');
    expect(heatAt(400)).toBe('freezing');
  });

  it('points the compass the right way', () => {
    const o = { x: 0, y: 0 };
    expect(bearingTo(o, { x: 10, y: 0 })).toBe('E');
    expect(bearingTo(o, { x: 0, y: 10 })).toBe('S');
    expect(bearingTo(o, { x: -10, y: 0 })).toBe('W');
    expect(bearingTo(o, { x: 0, y: -10 })).toBe('N');
    expect(bearingTo(o, { x: 10, y: -10 })).toBe('NE');
  });

  it('rewards finding it in few digs', () => {
    expect(treasureScore(3, 1)).toBe(8);
    expect(treasureScore(3, 3)).toBe(8);
    expect(treasureScore(3, 8)).toBe(3);
    expect(treasureScore(3, 20)).toBe(3);
  });

  it('rolls every treasure', () => {
    expect(rollTreasure(0).id).toBe('bottle');
    expect(rollTreasure(0.999).id).toBe('chest');
  });
});
