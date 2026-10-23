import { z } from 'zod';
import { AVATAR_COUNT, NAME_MAX_LEN } from './constants.js';

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PLAYER_STATUSES = ['walking', 'sitting', 'focusing', 'away'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** Client → server message type names. */
export const ClientMsg = {
  Move: 'move',
} as const;

/** Server → client message type names. */
export const ServerMsg = {
  /** Server rejected a move; client must snap back to this position. */
  MoveCorrect: 'move:correct',
} as const;

/** Finite number within a sane world range (guards against NaN/Infinity/huge values). */
const coord = z.number().finite().min(-1_000).max(100_000);

export const moveSchema = z.strictObject({
  x: coord,
  y: coord,
  dir: z.enum(DIRECTIONS),
  moving: z.boolean(),
});
export type MoveMessage = z.infer<typeof moveSchema>;

export const moveCorrectSchema = z.object({ x: z.number(), y: z.number() });
export type MoveCorrectMessage = z.infer<typeof moveCorrectSchema>;

/**
 * Display name: letters, digits, space, dash, underscore. Phase 1 only; from Phase 2 the
 * name comes from the authenticated profile instead of join options.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX_LEN)
  .regex(/^[\p{L}\p{N} _-]+$/u);

export const townJoinOptionsSchema = z.object({
  name: nameSchema,
  avatar: z
    .number()
    .int()
    .min(0)
    .max(AVATAR_COUNT - 1),
});
export type TownJoinOptions = z.infer<typeof townJoinOptionsSchema>;
