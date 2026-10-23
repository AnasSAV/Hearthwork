import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED } from './constants.js';
import { canStand, stepMovement, validateMove, type CollisionGrid } from './movement.js';

/** w×h grid with a solid border and one solid tile at (3, 2). */
function makeGrid(w = 6, h = 6): CollisionGrid {
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) solid[y * w + x] = 1;
    }
  }
  solid[2 * w + 3] = 1;
  return { width: w, height: h, tileSize: 16, solid };
}

describe('canStand', () => {
  const grid = makeGrid();

  it('allows open floor', () => {
    expect(canStand(grid, 24, 30)).toBe(true);
  });

  it('rejects feet overlapping a solid tile', () => {
    expect(canStand(grid, 3 * 16 + 8, 2 * 16 + 10)).toBe(false);
  });

  it('treats out-of-bounds as solid', () => {
    expect(canStand(grid, -5, 30)).toBe(false);
    expect(canStand(grid, 24, 1000)).toBe(false);
  });
});

describe('stepMovement', () => {
  const grid = makeGrid();

  it('moves at PLAYER_SPEED', () => {
    const next = stepMovement(grid, { x: 24, y: 40 }, { x: 1, y: 0 }, 100);
    expect(next.x).toBeCloseTo(24 + PLAYER_SPEED * 0.1);
    expect(next.y).toBe(40);
  });

  it('normalises diagonal input', () => {
    const next = stepMovement(grid, { x: 24, y: 40 }, { x: 1, y: 1 }, 100);
    expect(Math.hypot(next.x - 24, next.y - 40)).toBeCloseTo(PLAYER_SPEED * 0.1);
  });

  it('stops at walls but slides along them', () => {
    // Pressing up-left against the left border wall: x is blocked, y still moves.
    const start = { x: 16 + 5, y: 60 };
    const next = stepMovement(grid, start, { x: -1, y: -1 }, 100);
    expect(next.x).toBe(start.x);
    expect(next.y).toBeLessThan(start.y);
  });
});

describe('validateMove', () => {
  const grid = makeGrid();

  it('accepts a normal step', () => {
    expect(validateMove(grid, { x: 24, y: 40 }, { x: 32, y: 40 }, 100)).toEqual({ ok: true });
  });

  it('rejects moving faster than allowed', () => {
    expect(validateMove(grid, { x: 24, y: 40 }, { x: 70, y: 40 }, 100)).toEqual({
      ok: false,
      reason: 'too_fast',
    });
  });

  it('does not credit long idle gaps (no stored-up teleport)', () => {
    const wide = makeGrid(12, 6);
    // 60px is more than the 500ms credit cap allows, however long the player stood still.
    expect(validateMove(wide, { x: 24, y: 70 }, { x: 84, y: 70 }, 10_000)).toEqual({
      ok: false,
      reason: 'too_fast',
    });
  });

  it('rejects ending inside a wall', () => {
    expect(validateMove(grid, { x: 40, y: 47 }, { x: 56, y: 44 }, 300)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('rejects passing through a wall', () => {
    // From left of the solid tile (3,2) to right of it along the same row.
    const from = { x: 2 * 16 + 8, y: 2 * 16 + 12 };
    const to = { x: 4 * 16 + 8, y: 2 * 16 + 12 };
    expect(validateMove(grid, from, to, 500)).toEqual({ ok: false, reason: 'blocked' });
  });
});
