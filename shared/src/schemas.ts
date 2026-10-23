import { z } from 'zod';
import { AVATAR_COUNT, FOCUS_BLOCKS, type FocusBlock } from './constants.js';

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
} as const;

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
  audioOnly: z.boolean(),
});
export type FocusStartMessage = z.infer<typeof focusStartSchema>;

export const focusBeatSchema = z.strictObject({
  visible: z.boolean(),
  lastInputAgoSec: z.number().finite().min(0).max(86_400),
});
export type FocusBeatMessage = z.infer<typeof focusBeatSchema>;

export const townJoinSchema = z.object({
  /** Coming out of the house on this plot: spawn on its doorstep. */
  fromPlot: z.number().int().min(0).max(255).optional(),
});
export type TownJoinOptions = z.infer<typeof townJoinSchema>;

export const houseJoinSchema = z.object({
  ownerId: z.uuid(),
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
  audioOnly: boolean;
  verifiedMin: number;
  coinsEarned: number;
  awaitingPresence: boolean;
  /** Why the last beat didn't count, if it didn't. */
  lastMiss: string | null;
}

export type FocusEndReason = 'completed' | 'ended' | 'replaced' | 'missed_beats' | 'left' | 'error';

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

export const avatarSchema = z.object({
  body: z
    .number()
    .int()
    .min(0)
    .max(AVATAR_COUNT - 1),
});
export type Avatar = z.infer<typeof avatarSchema>;
