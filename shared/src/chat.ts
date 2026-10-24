import { z } from 'zod';

export const CHAT_MAX_LEN = 200;
/** One message per second per player. */
export const CHAT_MIN_INTERVAL_MS = 1000;
/** Messages kept per room (for late joiners and for reports). */
export const CHAT_HISTORY = 50;
/** Messages sent to someone who just joined. */
export const CHAT_BACKLOG = 20;

export const chatSendSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(CHAT_MAX_LEN * 2), // trimmed/cleaned and re-checked by the server
});

/** Whispers only reach players within this distance (and only while they stay that close). */
export const WHISPER_RANGE_TILES = 4;
export const WHISPER_RANGE_PX = WHISPER_RANGE_TILES * 16;

export const whisperSendSchema = z.strictObject({
  /** Colyseus session id of the recipient (in the same room). */
  to: z.string().min(1).max(64),
  text: z
    .string()
    .min(1)
    .max(CHAT_MAX_LEN * 2),
});

export const chatReportSchema = z.strictObject({
  messageId: z.string().min(1).max(64),
  reason: z.string().max(200).optional(),
});

export interface ChatMessage {
  id: string;
  /** Colyseus session of the sender (for the speech bubble). */
  sessionId: string;
  /** Supabase user id of the sender (for muting). */
  userId: string;
  name: string;
  text: string;
  /** Server time (ms). */
  at: number;
}

export interface ChatParty {
  sessionId: string;
  userId: string;
  name: string;
}

/** A private message. `sessionId`/`userId`/`name` are the sender, as in ChatMessage. */
export interface WhisperMessage extends ChatMessage {
  to: ChatParty;
}

export interface ChatNotice {
  message: string;
}

/** Strip control and zero-width characters, collapse whitespace, cap the length. */
export function cleanChatText(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHAT_MAX_LEN)
  );
}

// ---------------------------------------------------------------------------------------------
// Profanity filter
// ---------------------------------------------------------------------------------------------
// A small, deliberately conservative English list. Stems also match longer words ("fucking");
// short words only match on their own to avoid the Scunthorpe problem ("cocktail", "Dickens").
// Extend these lists as needed; matching tolerates repeated letters and common l33t swaps.

const STEMS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'bastard',
  'slut',
  'whore',
  'wank',
  'motherf',
];
const WORDS = [
  'dick',
  'cock',
  'prick',
  'twat',
  'fag',
  'faggot',
  'retard',
  'retarded',
  'nigger',
  'nigga',
  'kys',
];

const LEET: Record<string, string> = {
  a: '[a@4]',
  e: '[e3]',
  i: '[i1!|]',
  o: '[o0]',
  s: '[s$5]',
  t: '[t7+]',
  g: '[g9]',
  l: '[l1|]',
};

function letters(word: string): string {
  // Each letter may repeat ("fuuuck") and be separated by dots/spaces/dashes ("f.u.c.k").
  return [...word].map((ch) => `${LEET[ch] ?? ch}+`).join('[\\s._*-]*');
}

const PATTERN = new RegExp(
  [
    ...STEMS.map((w) => `(?<![a-z0-9])${letters(w)}[a-z]*`),
    ...WORDS.map((w) => `(?<![a-z0-9])${letters(w)}s?(?![a-z0-9])`),
  ].join('|'),
  'gi',
);

/** Replace profanity with asterisks of the same length. */
export function filterProfanity(text: string): string {
  return text.replace(PATTERN, (m) => '*'.repeat(m.length));
}

// ---------------------------------------------------------------------------------------------
// Emotes and typing
// ---------------------------------------------------------------------------------------------

/** Speech-bubble emotes a player can pop over their head (art: tools/art/build_ui.py). */
export const EMOTES = [
  'heart',
  'music',
  'zzz',
  'idea',
  'question',
  'sun',
  'moon',
  'sweat',
  'star',
  'trophy',
] as const;
export type Emote = (typeof EMOTES)[number];

export const emoteSendSchema = z.strictObject({ emote: z.enum(EMOTES) });
export const typingSchema = z.strictObject({ typing: z.boolean() });

/** One emote every this many ms per player (more are dropped). */
export const EMOTE_MIN_INTERVAL_MS = 1200;

export interface EmoteMessage {
  sessionId: string;
  emote: Emote;
}
