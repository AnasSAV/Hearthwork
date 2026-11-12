import { z } from 'zod';
import { FOCUS_BLOCKS, type FocusBlock } from './constants.js';
import { GAME_IDS } from './games.js';

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PLAYER_STATUSES = ['walking', 'sitting', 'focusing', 'away'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** Client → server message type names. Clients only ever send intents. */
export const ClientMsg = {
  Move: 'move',
  FocusStart: 'focus:start',
  FocusBeat: 'focus:beat',
  FocusConfirm: 'focus:confirm',
  FocusEnd: 'focus:end',
  /** Owner saved a layout, upgraded or changed settings: reload the house from the database. */
  HouseReload: 'house:reload',
  /** Go through the front door (yard ↔ inside); the server checks you're standing at it. */
  HouseDoor: 'house:door',
  /** The player changed their name or character: reload it from the database. */
  ProfileReload: 'profile:reload',
  Chat: 'chat',
  ChatReport: 'chat:report',
  /** Private message to a nearby player. */
  Whisper: 'whisper',
  /** Pop an emote bubble over your head. */
  Emote: 'emote',
  /** Started or stopped typing in chat (shows "…" over your head). */
  Typing: 'typing',
  /** The action button in a mini-game. The server decides what it means right now. */
  GameUse: 'game:use',
} as const;

/** Server → client message type names. */
export const ServerMsg = {
  /** Server rejected a move; client must snap back to this position. */
  MoveCorrect: 'move:correct',
  /** The player's balance and focus stats (sent on join and after every award). */
  Wallet: 'wallet',
  /** Current focus session state (sent on start, after each beat, on presence prompts). */
  FocusState: 'focus:state',
  /** The focus session closed. */
  FocusEnded: 'focus:ended',
  /** A focus request was refused (e.g. not at a desk). */
  FocusError: 'focus:error',
  /** Something the player should know about the house (e.g. it was made private). */
  HouseNotice: 'house:notice',
  /** One chat message (ChatMessage). */
  Chat: 'chat',
  /** Recent messages for someone who just joined (ChatMessage[]). */
  ChatHistory: 'chat:history',
  /** Feedback about chat (rate limit, report received). */
  ChatNotice: 'chat:notice',
  /** Server time in ms, for synced clocks (radio, table timers). */
  Clock: 'clock',
  /** A private message (WhisperMessage), sent only to its two participants. */
  Whisper: 'whisper',
  /** Someone popped an emote (EmoteMessage). */
  Emote: 'emote',
  /** Something happened in your mini-game (GameEvent). */
  GameEvent: 'game:event',
  /** Your score and earnings in this visit to a mini-game (GameStatusMessage). */
  GameStatus: 'game:status',
} as const;

export interface ClockMessage {
  now: number;
}

// ---------------------------------------------------------------------------------------------
// Client → server payloads
// ---------------------------------------------------------------------------------------------

/** Finite number within a sane world range (guards against NaN/Infinity/huge values). */
const coord = z.number().finite().min(-1_000).max(100_000);

/** Messages with no payload: `room.send(type)` delivers `undefined`. */
export const emptySchema = z.union([z.undefined(), z.strictObject({})]);

export const moveSchema = z.strictObject({
  x: coord,
  y: coord,
  dir: z.enum(DIRECTIONS),
  moving: z.boolean(),
});
export type MoveMessage = z.infer<typeof moveSchema>;

export const focusStartSchema = z.strictObject({
  /** Name of the desk object in the map the player is sitting at. */
  deskId: z.string().min(1).max(40),
  plannedMin: z.union([...FOCUS_BLOCKS.map((b) => z.literal(b)), z.null()]),
});
export type FocusStartMessage = z.infer<typeof focusStartSchema>;

export const focusBeatSchema = z.strictObject({
  inGame: z.boolean(),
  lastInputAgoSec: z.number().finite().min(0).max(86_400),
});
export type FocusBeatMessage = z.infer<typeof focusBeatSchema>;

export const townJoinSchema = z.object({});
export type TownJoinOptions = z.infer<typeof townJoinSchema>;

export const gameJoinSchema = z.object({ game: z.enum(GAME_IDS) });
export type GameJoinOptions = z.infer<typeof gameJoinSchema>;

export const houseJoinSchema = z.object({
  ownerId: z.uuid(),
  /** Where to appear: at the garden gate (arriving from town, default) or on the doorstep. */
  at: z.enum(['gate', 'door']).optional(),
});
export type HouseJoinOptions = z.infer<typeof houseJoinSchema>;

// ---------------------------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------------------------

export const moveCorrectSchema = z.object({ x: z.number(), y: z.number() });
export type MoveCorrectMessage = z.infer<typeof moveCorrectSchema>;

export interface WalletMessage {
  coins: number;
  streakDays: number;
  totalFocusMin: number;
  /** Minutes today that already earned coins (UTC day). */
  todayCoinMinutes: number;
  dailyCapMin: number;
}

export interface FocusStateMessage {
  sessionId: string;
  plannedMin: FocusBlock | null;
  verifiedMin: number;
  coinsEarned: number;
  awaitingPresence: boolean;
  /** "Still here?" went unanswered too long: minutes aren't counting until it's answered. */
  paused: boolean;
  /** Why the last beat didn't count, if it didn't. */
  lastMiss: string | null;
}

export type FocusEndReason =
  'completed' | 'ended' | 'replaced' | 'missed_beats' | 'left' | 'table_finished' | 'error';

export interface FocusEndedMessage {
  reason: FocusEndReason;
  verifiedMin: number;
  coinsEarned: number;
  bonus: number;
}

export interface FocusErrorMessage {
  message: string;
}

export interface HouseNoticeMessage {
  message: string;
  /** The player must leave (e.g. the owner made the house private). */
  leave: boolean;
}

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------

/** Same rule as the `profiles.username` CHECK constraint. */
export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,16}$/, '3–16 letters, digits or underscores');
