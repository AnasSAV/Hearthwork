/** Tile size in pixels for every map and tileset (Kenney 16×16 packs). */
export const TILE_SIZE = 16;

/** Walking speed in world pixels per second. */
export const PLAYER_SPEED = 80;

/**
 * Collision box around the player's feet. A player's (x, y) is the point between their
 * feet; the box spans [x - w/2, x + w/2] × [y - h, y].
 */
export const PLAYER_FEET = { w: 10, h: 6 } as const;

/** How often the client sends its predicted position while moving. */
export const MOVE_SEND_INTERVAL_MS = 100;
/** Server drops move messages that arrive closer together than this. */
export const MOVE_MIN_INTERVAL_MS = 50;
/** Longest gap the server credits when checking how far a player may have walked. */
export const MOVE_MAX_CREDIT_MS = 500;
/** Multiplier on PLAYER_SPEED the server tolerates for network jitter. */
export const MOVE_SPEED_TOLERANCE = 1.3;
/** Extra pixels of slack the server tolerates per move message. */
export const MOVE_SLACK_PX = 4;

/** Players per town instance; Colyseus spins up another instance when full. */
export const TOWN_MAX_CLIENTS = 50;

/** Seconds the server keeps a dropped player's seat for automatic reconnection. */
export const RECONNECT_GRACE_SEC = 20;

export const NAME_MAX_LEN = 16;
export const AVATAR_COUNT = 6;
