/** Tile size in pixels for every map and tileset (LimeZu 16×16 packs). */
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
/** Owner plus visitors in one house. */
export const HOUSE_MAX_CLIENTS = 16;
/** Players per mini-game instance; another instance opens when full. */
export const GAME_MAX_CLIENTS = 24;

/** A player can pinch someone this often, and the same friend this often. */
export const PINCH_EVERY_MS = 3_000;
export const PINCH_SAME_FRIEND_EVERY_MS = 20_000;

/** Seconds the server keeps a dropped player's seat for automatic reconnection. */
export const RECONNECT_GRACE_SEC = 20;

export const NAME_MAX_LEN = 16;

// ---------------------------------------------------------------------------------------------
// Focus economy. The server passes the reward constants to the `award_focus` SQL function, so
// tuning them here is enough (the SQL defaults only matter for manual calls).
// ---------------------------------------------------------------------------------------------

/** Coins per verified minute before the streak multiplier. */
export const BASE_RATE = 1;
/** Streak bonus per consecutive day: multiplier = 1 + STREAK_STEP × min(streakDays, STREAK_MAX_DAYS). */
export const STREAK_STEP = 0.05;
export const STREAK_MAX_DAYS = 10;
/** Verified minutes per UTC day that earn coins. Later minutes still count for stats and streaks. */
export const DAILY_REWARD_CAP_MIN = 480;

/** Pomodoro block lengths a player can pick (null = open-ended). */
export const FOCUS_BLOCKS = [25, 50] as const;
export type FocusBlock = (typeof FOCUS_BLOCKS)[number];
/** Bonus coins for finishing a whole block. */
export const COMPLETION_BONUS: Record<FocusBlock, number> = { 25: 5, 50: 12 };

/** Client sends a heartbeat this often while focusing. */
export const FOCUS_BEAT_INTERVAL_MS = 60_000;
/** Beats closer together than this are ignored. */
export const FOCUS_BEAT_MIN_INTERVAL_MS = 50_000;
/** A beat later than this after the previous one doesn't verify its minute. */
export const FOCUS_BEAT_LATE_MS = 80_000;
/**
 * With the game window in front, a minute only counts if the player touched keyboard, mouse or
 * screen within this many seconds. (Working in another window, the browser can't see input.)
 */
export const FOCUS_MAX_INPUT_IDLE_SEC = 600;
/** After this many verified minutes the player is asked "still here?". */
export const FOCUS_PRESENCE_EVERY_MIN = 25;
/** Minutes keep counting this long after the question; unanswered, the timer then pauses. */
export const FOCUS_PRESENCE_GRACE_MIN = 5;
/** This many missed beats in a row ends the session. */
export const FOCUS_MISSED_BEATS_LIMIT = 3;
/** Verified minutes are saved to the database in chunks of this size. */
export const FOCUS_AWARD_EVERY_MIN = 5;
/**
 * A group table's shared Pomodoro closes this long after its countdown ends, so the last
 * heartbeat (up to FOCUS_BEAT_LATE_MS late) can still complete the block.
 */
export const TABLE_GRACE_MS = 90_000;
