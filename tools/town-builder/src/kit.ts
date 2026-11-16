/** The pieces and ground tiles from tools/art/build_town_kit.py (kit/kit.json + kit.png). */

export const T = 16;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Category = 'buildings' | 'study' | 'nature' | 'decor' | 'water' | 'special';
export type Kind = 'tiles' | 'building' | 'desks' | 'tree' | 'anim' | 'spawn' | 'marker';
export type Cell = [number, number];

export interface Prefab {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
  /** Size in tiles. */
  w: number;
  h: number;
  /** First row with anything drawn in it (a sign goes just above). */
  top: number;
  frame: Frame;
  /** Cells (col, row) players can't walk through. */
  solid: Cell[];
  /** Cells no other piece may share: the piece's footprint on the grid. */
  base: Cell[];
  /** Top rows drawn over players (tree tops, lamp heads). */
  above: number;
  /** "decor": flat things drawn under everything (grass tufts). */
  layer?: 'decor';
  /** Only one in the town. */
  unique?: boolean;
  /** Lives in water (fish); everything else needs dry ground. */
  onWater?: boolean;
  /** Butterflies hover here. */
  flowers?: boolean;
  building?: { name: string; label: string; doorCol?: number };
  /** Chairs: the tile a seated player stands on, and which way they face. */
  seats?: { c: number; r: number; facing: 'left' | 'right' }[];
  /** All seats share one Pomodoro. */
  group?: boolean;
  tree?: { name: string; trunk: number };
  anim?: { name: string; frames: number; fps: number; strip: Frame };
  /** Only offered on these maps (all maps when missing). */
  maps?: string[];
  /** Mini-game markers: what the game reads from them. */
  role?: 'launch' | 'finish' | 'buoy' | 'label';
}

export interface Autotile {
  /** 3×3, row by row. */
  slice: Frame[];
  /** Outside showing at the tile's south-east, south-west, north-east, north-west corner. */
  inner: Frame[];
}

export interface Kit {
  tile: number;
  prefabs: Prefab[];
  terrain: {
    /** Plain grass, tufted grass. */
    grass: Frame[];
    /** Paving blocks, each 2×2 tiles (row by row). */
    paving: Frame[][];
    water: Autotile;
    /** Sand meeting grass. */
    sand: Autotile;
    /** Sand meeting the sea. */
    shore: Autotile;
    sea: Frame;
    planks: Frame;
  };
  /** Sprites the mini-games draw that aren't pieces (the raft, shells). */
  sprites: Record<string, Frame>;
}

/** How much of the grid a piece takes (its footprint's extent), which can be less than its picture. */
export function footprintSize(p: Prefab): { w: number; h: number } {
  const cols = p.base.map(([c]) => c);
  const rows = p.base.map(([, r]) => r);
  return {
    w: Math.max(...cols) - Math.min(...cols) + 1,
    h: Math.max(...rows) - Math.min(...rows) + 1,
  };
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'buildings', label: 'Buildings' },
  { id: 'study', label: 'Study tables' },
  { id: 'nature', label: 'Nature' },
  { id: 'decor', label: 'Decor' },
  { id: 'water', label: 'Water life' },
  { id: 'special', label: 'Special' },
];
