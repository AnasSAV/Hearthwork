import { describe, expect, it } from 'vitest';
import {
  atExit,
  atFrontDoor,
  atGate,
  canPlace,
  doorX,
  houseCollisionGrid,
  houseExteriorWidth,
  houseWorld,
  studySeats,
  validateLayout,
  YARD,
  YARD_ROOM,
  type HouseDims,
  type Placement,
} from './house.js';
import { canStand } from './movement.js';

const L1: HouseDims = { width: 8, height: 6, rooms: 1 };
const L3: HouseDims = { width: 12, height: 8, rooms: 2 };
const at = (itemId: string, x: number, y: number, room = 0): Placement => ({
  itemId,
  room,
  x,
  y,
  rotation: 0,
});

describe('canPlace', () => {
  it('places furniture on the floor and wall items on the top wall', () => {
    expect(canPlace(L1, [], at('table_oval', 1, 1))).toEqual({ ok: true });
    expect(canPlace(L1, [], at('painting_meadow', 2, 0))).toEqual({ ok: true });
  });

  it('keeps furniture off the wall row and wall items off the floor', () => {
    expect(canPlace(L1, [], at('table_side', 2, 0)).ok).toBe(false);
    expect(canPlace(L1, [], at('painting_meadow', 2, 1)).ok).toBe(false);
  });

  it('respects room bounds and rooms the house has', () => {
    expect(canPlace(L1, [], at('rug_amber', 7, 2)).ok).toBe(false); // 2 wide from x=7 → 9 > 8
    expect(canPlace(L1, [], at('bed_single', 1, 5)).ok).toBe(false); // 2 tall from y=5 → 7 > 6
    expect(canPlace(L1, [], at('stool', 1, 1, 1)).ok).toBe(false);
    expect(canPlace(L3, [], at('stool', 1, 1, 1)).ok).toBe(true);
  });

  it('forbids overlap within a layer but lets rugs sit under furniture', () => {
    const existing = [at('rug_amber', 1, 2)];
    expect(canPlace(L1, existing, at('rug_oval', 2, 2)).ok).toBe(false);
    expect(canPlace(L1, existing, at('table_side', 2, 2)).ok).toBe(true);
    expect(canPlace(L1, [at('table_oval', 1, 1)], at('stool', 2, 2)).ok).toBe(false);
  });

  it('puts surface items only on tables and desks', () => {
    expect(canPlace(L1, [], at('candelabra_gold', 2, 2)).ok).toBe(false);
    expect(canPlace(L1, [at('stool', 2, 2)], at('candelabra_gold', 2, 2)).ok).toBe(false);
    expect(canPlace(L1, [at('table_side', 2, 2)], at('candelabra_gold', 2, 2)).ok).toBe(true);
  });

  it('keeps the front door and the doorway between rooms clear', () => {
    expect(canPlace(L1, [], at('stool', doorX(L1), L1.height - 1)).ok).toBe(false);
    expect(canPlace(L1, [], at('rug_oval', doorX(L1), L1.height - 2)).ok).toBe(true);
    expect(canPlace(L3, [], at('stool', L3.width - 1, 4)).ok).toBe(false);
    expect(canPlace(L3, [], at('stool', 0, 4, 1)).ok).toBe(false);
  });

  it('does not place wallpapers, floors or unknown items', () => {
    expect(canPlace(L1, [], at('wall_wood', 1, 0)).ok).toBe(false);
    expect(canPlace(L1, [], at('floor_oak', 1, 1)).ok).toBe(false);
    expect(canPlace(L1, [], at('nope', 1, 1)).ok).toBe(false);
  });
});

describe('validateLayout', () => {
  it('accepts surface items listed before their table', () => {
    const layout = [at('candelabra_gold', 2, 2), at('table_side', 2, 2)];
    expect(validateLayout(L1, layout)).toEqual({ ok: true });
  });
});

describe('interior world', () => {
  it('lets players walk on free floor, not into furniture or walls', () => {
    const grid = houseCollisionGrid(L1, [at('table_oval', 1, 1)]);
    const spawn = houseWorld.insideSpawn(L1);
    expect(canStand(grid, spawn.x, spawn.y)).toBe(true);
    const o = houseWorld.roomOrigin(L1, 0);
    const center = (tx: number, ty: number) => [(o.x + tx) * 16 + 8, (o.y + ty) * 16 + 14] as const;
    expect(canStand(grid, ...center(1, 1))).toBe(false); // table
    expect(canStand(grid, ...center(5, 0))).toBe(false); // wall row
    expect(canStand(grid, ...center(5, 3))).toBe(true);
    const exit = houseWorld.exitTile(L1);
    expect(canStand(grid, exit.x * 16 + 8, exit.y * 16 + 10)).toBe(true);
  });

  it('offers study seats below desks and tables', () => {
    const seats = studySeats(L1, [{ ...at('desk_study', 2, 2), id: 'd1' }]);
    expect(seats.map((s) => s.id)).toEqual(['d1:0', 'd1:1']);
    const o = houseWorld.roomOrigin(L1, 0);
    expect(seats[0]!.tile).toEqual({ x: o.x + 2, y: o.y + 3 });
  });
});

describe('yard', () => {
  const yardAt = (itemId: string, x: number, y: number) => at(itemId, x, y, YARD_ROOM);

  it('takes garden items only, and garden items only go there', () => {
    expect(canPlace(L1, [], yardAt('garden_bush', 16, 8))).toEqual({ ok: true });
    expect(canPlace(L1, [], yardAt('table_oval', 16, 8)).ok).toBe(false);
    expect(canPlace(L1, [], at('garden_bush', 1, 1)).ok).toBe(false);
  });

  it('keeps the house, the paths and the yard bounds clear', () => {
    expect(canPlace(L1, [], yardAt('garden_bush', 6, 2)).ok).toBe(false); // the house
    expect(canPlace(L1, [], yardAt('garden_hedge', 7, 9)).ok).toBe(false); // path to the door
    expect(canPlace(L1, [], yardAt('garden_mailbox', 3, 12)).ok).toBe(false); // path to the gate
    expect(canPlace(L1, [], yardAt('garden_bush', YARD.width - 1, 3)).ok).toBe(false);
    expect(canPlace(L1, [], yardAt('garden_flowers_blue', 0, 0))).toEqual({ ok: true });
  });

  it('is walkable around the house, with doors and a gate to town', () => {
    const grid = houseCollisionGrid(L1, [yardAt('garden_bush', 16, 8)], undefined, 6);
    const arrival = houseWorld.arrivalSpawn();
    expect(canStand(grid, arrival.x, arrival.y)).toBe(true);
    const door = houseWorld.doorstepSpawn();
    expect(canStand(grid, door.x, door.y)).toBe(true);
    expect(atFrontDoor(door)).toBe(true);
    const o = houseWorld.roomOrigin(L1, YARD_ROOM);
    const center = (tx: number, ty: number) => [(o.x + tx) * 16 + 8, (o.y + ty) * 16 + 14] as const;
    expect(canStand(grid, ...center(6, 3))).toBe(false); // small house
    expect(canStand(grid, ...center(12, 3))).toBe(true); // beside it (only 6 wide at level 1)
    expect(canStand(grid, ...center(16, 8))).toBe(false); // the bush
    const gate = houseWorld.gateTiles()[0]!;
    expect(canStand(grid, gate.x * 16 + 8, gate.y * 16 + 14)).toBe(true);
    expect(atGate({ x: gate.x * 16 + 8, y: gate.y * 16 + 14 })).toBe(true);
    expect(atExit(L1, houseWorld.insideSpawn(L1))).toBe(true);
    expect(houseExteriorWidth(3)).toBe(10);
  });

  it('offers study seats at garden tables', () => {
    const seats = studySeats(L1, [{ ...yardAt('garden_table', 14, 9), id: 't' }]);
    expect(seats).toHaveLength(2);
  });
});
