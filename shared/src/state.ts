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

export const TownState = schema(
  {
    players: t.map(PlayerState),
    /** People in a focus session right now, across the whole server (for the HUD). */
    focusingNow: t.uint16(),
  },
  'TownState',
);
export type TownState = SchemaType<typeof TownState>;
