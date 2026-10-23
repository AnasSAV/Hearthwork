import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced player state. Uses the decorator-free `schema()` builder so no special
 * tsconfig flags are needed and both client and server can import it.
 */
export const PlayerState = schema(
  {
    id: t.string(),
    name: t.string(),
    avatar: t.uint8(),
    x: t.number(),
    y: t.number(),
    /** One of DIRECTIONS. */
    dir: t.string(),
    moving: t.boolean(),
    /** One of PLAYER_STATUSES. */
    status: t.string(),
    focusMin: t.uint16(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** A house shown on one of the town's lots. */
export const LotState = schema(
  {
    plotIndex: t.uint8(),
    ownerId: t.string(),
    ownerName: t.string(),
    level: t.uint8(),
    /** 'cottage' | 'brick' */
    style: t.string(),
  },
  'LotState',
);
export type LotState = SchemaType<typeof LotState>;

/** A group table's shared Pomodoro: everyone seated there counts down to the same end. */
export const TableTimerState = schema(
  {
    tableId: t.string(),
    plannedMin: t.uint8(),
    /** Server time (ms). */
    startedAt: t.number(),
    endsAt: t.number(),
    seated: t.uint8(),
  },
  'TableTimerState',
);
export type TableTimerState = SchemaType<typeof TableTimerState>;

export const TownState = schema(
  {
    players: t.map(PlayerState),
    /** Keyed by plot index. Empty lots are absent. */
    lots: t.map(LotState),
    /** Running group-table Pomodoros, keyed by table id. */
    tables: t.map(TableTimerState),
    /** People in a focus session right now, across the whole server (for the HUD). */
    focusingNow: t.uint16(),
  },
  'TownState',
);
export type TownState = SchemaType<typeof TownState>;

export const PlacedItemState = schema(
  {
    /** placed_items.id */
    id: t.string(),
    itemId: t.string(),
    room: t.uint8(),
    x: t.uint8(),
    y: t.uint8(),
  },
  'PlacedItemState',
);
export type PlacedItemState = SchemaType<typeof PlacedItemState>;

export const HouseState = schema(
  {
    ownerId: t.string(),
    ownerName: t.string(),
    level: t.uint8(),
    width: t.uint8(),
    height: t.uint8(),
    rooms: t.uint8(),
    /** Item ids; '' = default look. */
    wallpaper: t.string(),
    floor: t.string(),
    /** 'public' | 'friends' | 'private' */
    visibility: t.string(),
    exteriorStyle: t.string(),
    items: t.array(PlacedItemState),
    players: t.map(PlayerState),
    focusingNow: t.uint16(),
  },
  'HouseState',
);
export type HouseState = SchemaType<typeof HouseState>;
