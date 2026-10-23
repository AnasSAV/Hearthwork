/**
 * Furniture and decoration catalog. This is the source for supabase/seed.sql
 * (`npm run seed:items` regenerates it); the database copy is authoritative at runtime, and
 * prices are only ever read from there by the server/SQL.
 *
 * Sprites are rectangles of 16×16 tiles in furniture.png / room.png (client/public/assets/tilesets,
 * built from LimeZu's Modern Interiors by tools/art/build_interiors.py). An item's `size` is its
 * footprint on the room grid; its sprite is as wide and may be taller, drawn bottom-aligned so the
 * extra rows rise above the footprint. Wallpapers and floors use 3×2 blocks that repeat.
 */
import { FURNITURE_SHEET, FURNITURE_SPRITES, ROOM_SHEET, ROOM_SPRITES } from './interiorSprites.js';

export const ITEM_CATEGORIES = ['furniture', 'decor', 'plant', 'wall', 'floor'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * Where an item sits in a house:
 * - floor: normal furniture, one per tile
 * - rug: under floor items
 * - surface: must sit on a table/desk (an item with `surfaceHost`)
 * - wall: hung on the top wall row
 * Wallpapers and floorings (categories `wall`/`floor`) restyle the room instead of being placed.
 */
export const ITEM_LAYERS = ['floor', 'rug', 'surface', 'wall'] as const;
export type ItemLayer = (typeof ITEM_LAYERS)[number];

export const SPRITE_SHEETS = {
  furniture: { url: 'assets/tilesets/furniture.png', ...FURNITURE_SHEET },
  room: { url: 'assets/tilesets/room.png', ...ROOM_SHEET },
} as const;
export type SpriteSheet = keyof typeof SPRITE_SHEETS;

export interface SpriteRect {
  sheet: SpriteSheet;
  /** Tile column/row of the top-left tile, and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  layer: ItemLayer;
  /** Footprint in tiles (`items.footprint_w/h`). */
  size: { w: number; h: number };
  sprite: SpriteRect;
  minHouseLevel: number;
  /** Surface items (lamps, candles…) can be placed on top of this item. */
  surfaceHost?: boolean;
  /** Players can sit below this desk/table in a house and start a focus session. */
  studySpot?: boolean;
}

/** `sheet:x,y,w,h`, as stored in `items.sprite_key`. */
export function spriteKey(s: SpriteRect): string {
  return `${s.sheet}:${s.x},${s.y},${s.w},${s.h}`;
}

export function parseSpriteKey(key: string): SpriteRect | null {
  const m = /^(furniture|room):(\d+),(\d+),(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  return {
    sheet: m[1] as SpriteSheet,
    x: Number(m[2]),
    y: Number(m[3]),
    w: Number(m[4]),
    h: Number(m[5]),
  };
}

const rect = (sheet: SpriteSheet, r: readonly number[] | undefined, what: string): SpriteRect => {
  if (!r) throw new Error(`No sprite for ${what}`);
  return { sheet, x: r[0]!, y: r[1]!, w: r[2]!, h: r[3]! };
};

/** Wallpapers and floors restyle a room with a 3×2 block from room.png; the rest is furniture. */
function spriteOf(id: string, category: ItemCategory): SpriteRect {
  return category === 'wall' || category === 'floor'
    ? rect('room', ROOM_SPRITES[`${category}:${id}`], id)
    : rect('furniture', FURNITURE_SPRITES[id], id);
}

/** The wall or floor block of a room without a wallpaper/flooring item. */
export const defaultRoomSprite = (kind: 'wall' | 'floor'): SpriteRect =>
  rect('room', ROOM_SPRITES[`${kind}:default`], `default ${kind}`);

/** The dark border around and between rooms. */
export const roomBorderSprite = (): SpriteRect => rect('room', ROOM_SPRITES.border, 'border');

type Def = Omit<CatalogItem, 'minHouseLevel' | 'sprite' | 'size'> & {
  size: [number, number];
  minHouseLevel?: number;
};

const DEFS: Def[] = [
  // --- Furniture (150–400) ---
  {
    id: 'table_long',
    name: 'Farmhouse table',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    size: [2, 2],
    surfaceHost: true,
    studySpot: true,
    minHouseLevel: 2,
  },
  {
    id: 'table_oval',
    name: 'Glass-top table',
    category: 'furniture',
    price: 300,
    layer: 'floor',
    size: [2, 2],
    surfaceHost: true,
    studySpot: true,
  },
  {
    id: 'table_round',
    name: 'Pine table',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    size: [2, 2],
    surfaceHost: true,
    studySpot: true,
  },
  {
    id: 'table_side',
    name: 'Side table',
    category: 'furniture',
    price: 150,
    layer: 'floor',
    size: [1, 1],
    surfaceHost: true,
    studySpot: true,
  },
  {
    id: 'table_low',
    name: 'Coffee table',
    category: 'furniture',
    price: 200,
    layer: 'floor',
    size: [2, 1],
    surfaceHost: true,
    studySpot: true,
  },
  {
    id: 'desk_study',
    name: 'Study desk',
    category: 'furniture',
    price: 260,
    layer: 'floor',
    size: [2, 1],
    surfaceHost: true,
    studySpot: true,
  },
  {
    id: 'chair_wood',
    name: 'Wooden chair',
    category: 'furniture',
    price: 150,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'chair_cushion',
    name: 'Cushioned chair',
    category: 'furniture',
    price: 170,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'bed_orange',
    name: 'Moss double bed',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    size: [2, 2],
  },
  {
    id: 'bed_green',
    name: 'Sky double bed',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    size: [2, 2],
  },
  {
    id: 'bed_single',
    name: 'Single bed',
    category: 'furniture',
    price: 250,
    layer: 'floor',
    size: [1, 2],
  },
  {
    id: 'piano',
    name: 'Upright piano',
    category: 'furniture',
    price: 400,
    layer: 'floor',
    size: [2, 1],
    minHouseLevel: 2,
  },
  {
    id: 'couch_orange',
    name: 'Tan loveseat',
    category: 'furniture',
    price: 390,
    layer: 'floor',
    size: [2, 1],
    minHouseLevel: 2,
  },
  {
    id: 'couch_green',
    name: 'Grey sofa',
    category: 'furniture',
    price: 390,
    layer: 'floor',
    size: [3, 1],
    minHouseLevel: 2,
  },
  {
    id: 'dresser',
    name: 'Low dresser',
    category: 'furniture',
    price: 240,
    layer: 'floor',
    size: [2, 1],
    surfaceHost: true,
  },
  {
    id: 'drawers',
    name: 'Chest of drawers',
    category: 'furniture',
    price: 240,
    layer: 'floor',
    size: [2, 1],
    surfaceHost: true,
  },
  {
    id: 'counter',
    name: 'Kitchen counter',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    size: [2, 1],
    surfaceHost: true,
  },
  {
    id: 'cabinet_books',
    name: 'Narrow bookcase',
    category: 'furniture',
    price: 180,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'cabinet_potions',
    name: 'Wardrobe',
    category: 'furniture',
    price: 190,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'shelf_wide',
    name: 'Tall bookshelf',
    category: 'furniture',
    price: 280,
    layer: 'floor',
    size: [2, 1],
  },
  {
    id: 'mirror_standing',
    name: 'Standing mirror',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'mirror_gilded',
    name: 'Framed mirror',
    category: 'furniture',
    price: 320,
    layer: 'floor',
    size: [1, 1],
    minHouseLevel: 3,
  },
  // --- Decor (40–80; rugs a bit more since they're big) ---
  {
    id: 'stool',
    name: 'Stool',
    category: 'decor',
    price: 50,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'pouf',
    name: 'Pouf',
    category: 'decor',
    price: 60,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'vase_bronze',
    name: 'Clay vase',
    category: 'decor',
    price: 60,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'vase_silver',
    name: 'Porcelain vase',
    category: 'decor',
    price: 70,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'candelabra_silver',
    name: 'Cream table lamp',
    category: 'decor',
    price: 65,
    layer: 'surface',
    size: [1, 1],
  },
  {
    id: 'candelabra_gold',
    name: 'Red table lamp',
    category: 'decor',
    price: 80,
    layer: 'surface',
    size: [1, 1],
  },
  {
    id: 'rug_amber',
    name: 'Checked rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    size: [2, 2],
  },
  {
    id: 'rug_oval',
    name: 'Round pink rug',
    category: 'decor',
    price: 90,
    layer: 'rug',
    size: [2, 2],
  },
  {
    id: 'rug_teal',
    name: 'Blue rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    size: [2, 2],
  },
  {
    id: 'rug_moss',
    name: 'Golden rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    size: [2, 2],
  },
  {
    id: 'rug_cream',
    name: 'Pink rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    size: [2, 2],
  },
  {
    id: 'painting_meadow',
    name: 'Meadow painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    size: [1, 1],
  },
  {
    id: 'painting_sunset',
    name: 'Ember painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    size: [1, 1],
  },
  {
    id: 'painting_lagoon',
    name: 'Abstract painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    size: [1, 1],
  },
  {
    id: 'painting_scroll',
    name: 'Flower painting',
    category: 'decor',
    price: 80,
    layer: 'wall',
    size: [1, 1],
  },
  {
    id: 'gallery_frames',
    name: 'Cork board',
    category: 'decor',
    price: 50,
    layer: 'wall',
    size: [2, 1],
  },
  {
    id: 'shield_round',
    name: 'Medal frame',
    category: 'decor',
    price: 75,
    layer: 'wall',
    size: [1, 1],
  },
  {
    id: 'torch',
    name: 'Trophy poster',
    category: 'decor',
    price: 55,
    layer: 'wall',
    size: [1, 1],
  },
  // --- Plants (40–80) ---
  {
    id: 'plant_fern',
    name: 'Potted fern',
    category: 'plant',
    price: 60,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'plant_bush',
    name: 'Fig tree',
    category: 'plant',
    price: 70,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'plant_mushrooms',
    name: 'Snake plant',
    category: 'plant',
    price: 40,
    layer: 'floor',
    size: [1, 1],
  },
  {
    id: 'plant_sprout',
    name: 'Bonsai',
    category: 'plant',
    price: 45,
    layer: 'surface',
    size: [1, 1],
  },
  // --- Wallpapers and floors (200 each, restyle the room) ---
  {
    id: 'wall_wood',
    name: 'Walnut wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    size: [3, 2],
  },
  {
    id: 'wall_stone',
    name: 'Brick wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    size: [3, 2],
  },
  {
    id: 'wall_pale',
    name: 'Cream wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    size: [3, 2],
  },
  {
    id: 'floor_oak',
    name: 'Oak floor',
    category: 'floor',
    price: 200,
    layer: 'floor',
    size: [3, 2],
  },
  {
    id: 'floor_amber',
    name: 'Herringbone floor',
    category: 'floor',
    price: 200,
    layer: 'floor',
    size: [3, 2],
  },
  {
    id: 'floor_moss',
    name: 'Walnut floor',
    category: 'floor',
    price: 200,
    layer: 'floor',
    size: [3, 2],
  },
];

export const CATALOG: readonly CatalogItem[] = DEFS.map(({ size, ...d }) => ({
  minHouseLevel: 1,
  ...d,
  size: { w: size[0], h: size[1] },
  sprite: spriteOf(d.id, d.category),
}));

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((i) => [i.id, i]),
);
