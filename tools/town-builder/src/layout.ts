import type { Cell, Kit, Prefab } from './kit';

/**
 * A town as the builder edits it: ground painted per tile, and pieces dropped on top. Saved as
 * tools/town-builder/town.layout.json and turned into the game's Tiled map on save.
 */
export const GROUND = {
  grass: '.',
  paving: '#',
  water: '~',
  sand: ':',
  sea: '%',
  /** Pier planks: walkable, usually over water. */
  planks: '=',
} as const;
export type Ground = keyof typeof GROUND;
export type GroundChar = (typeof GROUND)[Ground];

export interface Piece {
  uid: number;
  prefab: string;
  /** Top-left tile. */
  x: number;
  y: number;
  /** Buildings: the name shown above it ('' for none). */
  label?: string;
}

export interface Layout {
  version: 1;
  width: number;
  height: number;
  /** One string per row, one character per tile (see GROUND). */
  ground: string[];
  pieces: Piece[];
}

/** Ground nobody can walk on, where only water pieces (fish, rocks, boats) may go. */
export const isWet = (g: string): boolean => g === GROUND.water || g === GROUND.sea;

export const MIN_SIZE = 20;
export const MAX_SIZE = 160;

export class Town {
  readonly prefabs: Map<string, Prefab>;
  layout: Layout;
  private nextUid: number;

  constructor(
    readonly kit: Kit,
    layout: Layout,
  ) {
    this.prefabs = new Map(kit.prefabs.map((p) => [p.id, p]));
    this.layout = layout;
    this.nextUid = Math.max(0, ...layout.pieces.map((p) => p.uid)) + 1;
  }

  get width(): number {
    return this.layout.width;
  }

  get height(): number {
    return this.layout.height;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  groundAt(x: number, y: number): GroundChar {
    return (this.layout.ground[y]?.[x] ?? '.') as GroundChar;
  }

  prefabOf(p: Piece): Prefab {
    const f = this.prefabs.get(p.prefab);
    if (!f) throw new Error(`Unknown piece "${p.prefab}"`);
    return f;
  }

  /** Cells a piece claims on the grid, in map coordinates. */
  baseCells(prefab: Prefab, x: number, y: number): Cell[] {
    return prefab.base.map(([c, r]) => [x + c, y + r]);
  }

  /** The piece whose picture is under a tile, topmost (front-most) first. */
  pieceAt(tx: number, ty: number): Piece | null {
    const sorted = [...this.layout.pieces].sort(
      (a, b) => b.y + this.prefabOf(b).h - (a.y + this.prefabOf(a).h),
    );
    // Prefer a piece whose footprint is here, then any whose picture covers it.
    for (const p of sorted) {
      if (this.baseCells(this.prefabOf(p), p.x, p.y).some(([x, y]) => x === tx && y === ty))
        return p;
    }
    for (const p of sorted) {
      const f = this.prefabOf(p);
      if (tx >= p.x && tx < p.x + f.w && ty >= p.y && ty < p.y + f.h) return p;
    }
    return null;
  }

  /** Can `prefab` go with its top-left at (x, y)? `ignore`: a piece being moved. */
  check(prefab: Prefab, x: number, y: number, ignore?: Piece): { ok: boolean; reason?: string } {
    const cells = this.baseCells(prefab, x, y);
    if (cells.some(([cx, cy]) => !this.inside(cx, cy))) return { ok: false, reason: 'Off the map' };
    for (const [cx, cy] of cells) {
      const water = isWet(this.groundAt(cx, cy));
      if (prefab.onWater && !water) return { ok: false, reason: 'Needs water' };
      if (!prefab.onWater && water) return { ok: false, reason: 'Not on water' };
    }
    const mine = new Set(cells.map(([cx, cy]) => cy * this.width + cx));
    for (const p of this.layout.pieces) {
      if (p === ignore) continue;
      const other = this.prefabOf(p);
      if (this.baseCells(other, p.x, p.y).some(([cx, cy]) => mine.has(cy * this.width + cx))) {
        return { ok: false, reason: `On top of ${other.name}` };
      }
    }
    if (prefab.unique && this.layout.pieces.some((p) => p !== ignore && p.prefab === prefab.id)) {
      return { ok: false, reason: `There is already a ${prefab.name}` };
    }
    return { ok: true };
  }

  add(prefab: Prefab, x: number, y: number): Piece {
    const piece: Piece = { uid: this.nextUid++, prefab: prefab.id, x, y };
    if (prefab.building) piece.label = prefab.building.label;
    this.layout.pieces.push(piece);
    return piece;
  }

  remove(piece: Piece): void {
    this.layout.pieces = this.layout.pieces.filter((p) => p !== piece);
  }

  /** Paint ground; refuses water under pieces that need dry ground (and vice versa). */
  paint(cells: Cell[], ground: GroundChar): boolean {
    const blocked = new Set<number>();
    for (const p of this.layout.pieces) {
      const f = this.prefabOf(p);
      if (Boolean(f.onWater) === isWet(ground)) continue;
      for (const [cx, cy] of this.baseCells(f, p.x, p.y)) blocked.add(cy * this.width + cx);
    }
    const rows = this.layout.ground.map((r) => r.split(''));
    let changed = false;
    for (const [x, y] of cells) {
      if (!this.inside(x, y) || blocked.has(y * this.width + x)) continue;
      if (rows[y]![x] !== ground) {
        rows[y]![x] = ground;
        changed = true;
      }
    }
    if (changed) this.layout.ground = rows.map((r) => r.join(''));
    return changed;
  }

  /** Grow or shrink the map; `left`/`top` add (or remove) columns and rows on those sides. */
  resize(width: number, height: number, left: number, top: number): void {
    const ground: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const sx = x - left;
        const sy = y - top;
        row += this.inside(sx, sy) ? this.groundAt(sx, sy) : GROUND.grass;
      }
      ground.push(row);
    }
    const pieces = this.layout.pieces
      .map((p) => ({ ...p, x: p.x + left, y: p.y + top }))
      .filter((p) => {
        const f = this.prefabOf(p);
        return f.base.every(([c, r]) => {
          const x = p.x + c;
          const y = p.y + r;
          return x >= 0 && y >= 0 && x < width && y < height;
        });
      });
    this.layout = { ...this.layout, width, height, ground, pieces };
  }

  snapshot(): string {
    return JSON.stringify(this.layout);
  }

  restore(json: string): void {
    this.layout = JSON.parse(json) as Layout;
  }
}

export function blankLayout(width: number, height: number): Layout {
  return {
    version: 1,
    width,
    height,
    ground: Array.from({ length: height }, () => GROUND.grass.repeat(width)),
    pieces: [],
  };
}
