/**
 * Furniture and decoration catalog. This is the source for supabase/seed.sql
 * (`npm run seed:items` regenerates it); the database copy is authoritative at runtime, and
 * prices are only ever read from there by the server/SQL.
 *
 * Sprites are rectangles of 16×16 tiles in one of the tilesets under client/public/assets/tilesets.
 * The rectangle size is the item's footprint (w × h tiles).
 */

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
  indoor: { url: 'assets/tilesets/indoor.png', width: 432, height: 288 },
  tinytown: { url: 'assets/tilesets/tinytown.png', width: 192, height: 176 },
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
  sprite: SpriteRect;
  minHouseLevel: number;
  /** Surface items (lamps, candles…) can be placed on top of this item. */
  surfaceHost?: boolean;
}

/** `sheet:x,y,w,h`, as stored in `items.sprite_key`. */
export function spriteKey(s: SpriteRect): string {
  return `${s.sheet}:${s.x},${s.y},${s.w},${s.h}`;
}

export function parseSpriteKey(key: string): SpriteRect | null {
  const m = /^(indoor|tinytown):(\d+),(\d+),(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  return {
    sheet: m[1] as SpriteSheet,
    x: Number(m[2]),
    y: Number(m[3]),
    w: Number(m[4]),
    h: Number(m[5]),
  };
}

const at = (sheet: SpriteSheet, x: number, y: number, w = 1, h = 1): SpriteRect => ({
  sheet,
  x,
  y,
  w,
  h,
});

type Def = Omit<CatalogItem, 'minHouseLevel'> & { minHouseLevel?: number };

const DEFS: Def[] = [
  // --- Furniture (150–400) ---
  {
    id: 'table_long',
    name: 'Long dining table',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    sprite: at('indoor', 0, 0, 3, 2),
    surfaceHost: true,
    minHouseLevel: 2,
  },
  {
    id: 'table_oval',
    name: 'Oval table',
    category: 'furniture',
    price: 300,
    layer: 'floor',
    sprite: at('indoor', 3, 0, 2, 2),
    surfaceHost: true,
  },
  {
    id: 'table_round',
    name: 'Round table',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    sprite: at('indoor', 6, 0, 1, 2),
    surfaceHost: true,
  },
  {
    id: 'table_side',
    name: 'Side table',
    category: 'furniture',
    price: 150,
    layer: 'floor',
    sprite: at('indoor', 7, 0),
    surfaceHost: true,
  },
  {
    id: 'table_low',
    name: 'Low table',
    category: 'furniture',
    price: 200,
    layer: 'floor',
    sprite: at('indoor', 4, 4, 2, 1),
    surfaceHost: true,
  },
  {
    id: 'desk_study',
    name: 'Study desk',
    category: 'furniture',
    price: 260,
    layer: 'floor',
    sprite: at('indoor', 0, 15, 2, 1),
    surfaceHost: true,
  },
  {
    id: 'chair_wood',
    name: 'Wooden chair',
    category: 'furniture',
    price: 150,
    layer: 'floor',
    sprite: at('indoor', 0, 2),
  },
  {
    id: 'chair_cushion',
    name: 'Cushioned chair',
    category: 'furniture',
    price: 170,
    layer: 'floor',
    sprite: at('indoor', 0, 3),
  },
  {
    id: 'bed_orange',
    name: 'Cozy double bed',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    sprite: at('indoor', 14, 6, 2, 2),
  },
  {
    id: 'bed_green',
    name: 'Forest double bed',
    category: 'furniture',
    price: 380,
    layer: 'floor',
    sprite: at('indoor', 12, 6, 2, 2),
  },
  {
    id: 'bed_single',
    name: 'Single bed',
    category: 'furniture',
    price: 250,
    layer: 'floor',
    sprite: at('indoor', 8, 6, 1, 2),
  },
  {
    id: 'piano',
    name: 'Upright piano',
    category: 'furniture',
    price: 400,
    layer: 'floor',
    sprite: at('indoor', 23, 8, 2, 2),
    minHouseLevel: 2,
  },
  {
    id: 'couch_orange',
    name: 'Big amber couch',
    category: 'furniture',
    price: 390,
    layer: 'floor',
    sprite: at('indoor', 23, 11, 2, 3),
    minHouseLevel: 2,
  },
  {
    id: 'couch_green',
    name: 'Big moss couch',
    category: 'furniture',
    price: 390,
    layer: 'floor',
    sprite: at('indoor', 23, 15, 2, 3),
    minHouseLevel: 2,
  },
  {
    id: 'dresser',
    name: 'Dresser',
    category: 'furniture',
    price: 240,
    layer: 'floor',
    sprite: at('indoor', 0, 16, 2, 1),
    surfaceHost: true,
  },
  {
    id: 'drawers',
    name: 'Chest of drawers',
    category: 'furniture',
    price: 240,
    layer: 'floor',
    sprite: at('indoor', 0, 17, 2, 1),
    surfaceHost: true,
  },
  {
    id: 'counter',
    name: 'Kitchen counter',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    sprite: at('indoor', 0, 12, 2, 1),
    surfaceHost: true,
  },
  {
    id: 'cabinet_books',
    name: 'Book cabinet',
    category: 'furniture',
    price: 180,
    layer: 'floor',
    sprite: at('indoor', 5, 15),
  },
  {
    id: 'cabinet_potions',
    name: 'Potion cabinet',
    category: 'furniture',
    price: 190,
    layer: 'floor',
    sprite: at('indoor', 6, 15),
  },
  {
    id: 'shelf_wide',
    name: 'Wide display shelf',
    category: 'furniture',
    price: 280,
    layer: 'floor',
    sprite: at('indoor', 20, 17, 2, 1),
  },
  {
    id: 'mirror_standing',
    name: 'Standing mirror',
    category: 'furniture',
    price: 220,
    layer: 'floor',
    sprite: at('indoor', 22, 14, 1, 2),
  },
  {
    id: 'mirror_gilded',
    name: 'Gilded mirror',
    category: 'furniture',
    price: 320,
    layer: 'floor',
    sprite: at('indoor', 22, 16, 1, 2),
    minHouseLevel: 3,
  },

  // --- Decor (40–80; rugs a bit more since they're big) ---
  {
    id: 'stool',
    name: 'Stool',
    category: 'decor',
    price: 50,
    layer: 'floor',
    sprite: at('indoor', 16, 3),
  },
  {
    id: 'pouf',
    name: 'Pouf',
    category: 'decor',
    price: 60,
    layer: 'floor',
    sprite: at('indoor', 17, 3),
  },
  {
    id: 'vase_bronze',
    name: 'Bronze urn',
    category: 'decor',
    price: 60,
    layer: 'floor',
    sprite: at('indoor', 16, 4),
  },
  {
    id: 'vase_silver',
    name: 'Silver urn',
    category: 'decor',
    price: 70,
    layer: 'floor',
    sprite: at('indoor', 17, 4),
  },
  {
    id: 'candelabra_silver',
    name: 'Silver candelabra',
    category: 'decor',
    price: 65,
    layer: 'surface',
    sprite: at('indoor', 19, 0),
  },
  {
    id: 'candelabra_gold',
    name: 'Golden candelabra',
    category: 'decor',
    price: 80,
    layer: 'surface',
    sprite: at('indoor', 20, 0),
  },
  {
    id: 'rug_amber',
    name: 'Amber rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    sprite: at('indoor', 16, 8, 3, 1),
  },
  {
    id: 'rug_oval',
    name: 'Oval rug',
    category: 'decor',
    price: 90,
    layer: 'rug',
    sprite: at('indoor', 19, 8, 2, 1),
  },
  {
    id: 'rug_teal',
    name: 'Lagoon rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    sprite: at('indoor', 16, 14, 3, 1),
  },
  {
    id: 'rug_moss',
    name: 'Moss rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    sprite: at('indoor', 16, 16, 3, 1),
  },
  {
    id: 'rug_cream',
    name: 'Cream rug',
    category: 'decor',
    price: 120,
    layer: 'rug',
    sprite: at('indoor', 16, 17, 3, 1),
  },
  {
    id: 'painting_meadow',
    name: 'Meadow painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    sprite: at('indoor', 19, 12),
  },
  {
    id: 'painting_sunset',
    name: 'Sunset painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    sprite: at('indoor', 19, 13),
  },
  {
    id: 'painting_lagoon',
    name: 'Lagoon painting',
    category: 'decor',
    price: 70,
    layer: 'wall',
    sprite: at('indoor', 19, 14),
  },
  {
    id: 'painting_scroll',
    name: 'Scroll painting',
    category: 'decor',
    price: 80,
    layer: 'wall',
    sprite: at('indoor', 20, 12, 2, 1),
  },
  {
    id: 'gallery_frames',
    name: 'Gallery frames',
    category: 'decor',
    price: 50,
    layer: 'wall',
    sprite: at('indoor', 16, 12),
  },
  {
    id: 'shield_round',
    name: 'Round shield',
    category: 'decor',
    price: 75,
    layer: 'wall',
    sprite: at('indoor', 22, 9),
  },
  {
    id: 'torch',
    name: 'Wall torch',
    category: 'decor',
    price: 55,
    layer: 'wall',
    sprite: at('indoor', 21, 6),
  },

  // --- Plants (40–80) ---
  {
    id: 'plant_fern',
    name: 'Potted fern',
    category: 'plant',
    price: 60,
    layer: 'floor',
    sprite: at('indoor', 16, 0),
  },
  {
    id: 'plant_bush',
    name: 'Round shrub',
    category: 'plant',
    price: 70,
    layer: 'floor',
    sprite: at('tinytown', 5, 0),
  },
  {
    id: 'plant_mushrooms',
    name: 'Mushroom patch',
    category: 'plant',
    price: 40,
    layer: 'floor',
    sprite: at('tinytown', 5, 2),
  },
  {
    id: 'plant_sprout',
    name: 'Little sprout',
    category: 'plant',
    price: 45,
    layer: 'surface',
    sprite: at('indoor', 17, 0),
  },

  // --- Wallpapers and floors (200 each, restyle the room) ---
  {
    id: 'wall_wood',
    name: 'Timber wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    sprite: at('tinytown', 1, 6),
  },
  {
    id: 'wall_stone',
    name: 'Slate wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    sprite: at('tinytown', 5, 6),
  },
  {
    id: 'wall_pale',
    name: 'Pale stone wallpaper',
    category: 'wall',
    price: 200,
    layer: 'wall',
    sprite: at('tinytown', 1, 8),
  },
  {
    id: 'floor_oak',
    name: 'Oak floor',
    category: 'floor',
    price: 200,
    layer: 'floor',
    sprite: at('indoor', 23, 10),
  },
  {
    id: 'floor_amber',
    name: 'Amber planks',
    category: 'floor',
    price: 200,
    layer: 'floor',
    sprite: at('indoor', 24, 1),
  },
  {
    id: 'floor_moss',
    name: 'Moss carpet',
    category: 'floor',
    price: 200,
    layer: 'floor',
    sprite: at('indoor', 24, 5),
  },
];

export const CATALOG: readonly CatalogItem[] = DEFS.map((d) => ({ minHouseLevel: 1, ...d }));

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((i) => [i.id, i]),
);
