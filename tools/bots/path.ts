import { canStand, TILE_SIZE, type CollisionGrid, type Vec2 } from '@focus-town/shared';

/** Feet position in the middle of a tile (the feet box fits inside one tile there). */
const centre = (tx: number, ty: number): Vec2 => ({
  x: tx * TILE_SIZE + TILE_SIZE / 2,
  y: ty * TILE_SIZE + TILE_SIZE - 4,
});

/**
 * Waypoints for walking from `from` to `to` (feet positions) through tiles a player can stand
 * in: a breadth-first search over tile centres, ending exactly at `to`. Straight steps between
 * neighbouring centres never leave those two tiles, so every point on the way is legal.
 */
export function findPath(grid: CollisionGrid, from: Vec2, to: Vec2): Vec2[] {
  const tileOf = (p: Vec2) => ({
    x: Math.floor(p.x / TILE_SIZE),
    y: Math.floor((p.y - 1) / TILE_SIZE),
  });
  const start = tileOf(from);
  const goal = tileOf(to);
  const key = (x: number, y: number) => y * grid.width + x;
  const prev = new Map<number, number>([[key(start.x, start.y), -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const t = queue.shift()!;
    if (t.x === goal.x && t.y === goal.y) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= grid.width || n.y >= grid.height) continue;
      if (prev.has(key(n.x, n.y))) continue;
      const c = centre(n.x, n.y);
      if (!canStand(grid, c.x, c.y)) continue;
      prev.set(key(n.x, n.y), key(t.x, t.y));
      queue.push(n);
    }
  }
  if (!prev.has(key(goal.x, goal.y))) throw new Error(`no path to ${to.x},${to.y}`);
  const path: Vec2[] = [to];
  for (let k = prev.get(key(goal.x, goal.y))!; k !== -1; k = prev.get(k)!) {
    if (k !== key(start.x, start.y))
      path.unshift(centre(k % grid.width, Math.floor(k / grid.width)));
  }
  return path;
}
