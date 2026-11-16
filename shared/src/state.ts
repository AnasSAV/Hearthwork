import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced player state. Uses the decorator-free `schema()` builder so no special
 * tsconfig flags are needed and both client and server can import it.
 */
export const PlayerState = schema(
  {
    id: t.string(),
    name: t.string(),
    /** encodeAvatar() of the player's avatar. */
    avatar: t.string(),
    x: t.number(),
    y: t.number(),
    /** One of DIRECTIONS. */
    dir: t.string(),
    moving: t.boolean(),
    /** One of PLAYER_STATUSES. */
    status: t.string(),
    focusMin: t.uint16(),
    /** Typing in chat right now. */
    typing: t.boolean(),
    /** In a mini-game: 'cast' (line in the water), 'raft' (on the river), or ''. */
    mode: t.string(),
    /** While casting: where the float is, in world pixels. */
    castX: t.number(),
    castY: t.number(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

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
    /** Interior room index, or -1 for the yard. */
    room: t.int8(),
    x: t.uint8(),
    y: t.uint8(),
    /** User id of the housemate who placed it (their inventory it came from). */
    placedBy: t.string(),
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
    /** User ids of the people who live here (they can decorate). */
    members: t.array('string'),
    items: t.array(PlacedItemState),
    players: t.map(PlayerState),
    focusingNow: t.uint16(),
  },
  'HouseState',
);
export type HouseState = SchemaType<typeof HouseState>;

/** A butterfly in the meadow, flown by the server. */
export const CritterState = schema(
  {
    /** One of BUTTERFLY_KINDS' ids. */
    kind: t.string(),
    x: t.number(),
    y: t.number(),
  },
  'CritterState',
);
export type CritterState = SchemaType<typeof CritterState>;

export const GameState = schema(
  {
    players: t.map(PlayerState),
    /** Butterflies, in the meadow. */
    critters: t.map(CritterState),
    focusingNow: t.uint16(),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
