import { randomUUID } from 'node:crypto';
import type { MapSchema } from '@colyseus/schema';
import type { Client, Room } from 'colyseus';
import {
  CHAT_BACKLOG,
  CHAT_HISTORY,
  CHAT_MIN_INTERVAL_MS,
  ClientMsg,
  chatReportSchema,
  chatSendSchema,
  cleanChatText,
  EMOTE_MIN_INTERVAL_MS,
  emoteSendSchema,
  filterProfanity,
  ServerMsg,
  typingSchema,
  WHISPER_RANGE_PX,
  whisperSendSchema,
  type ChatMessage,
  type ChatNotice,
  type ClockMessage,
  type EmoteMessage,
  type PlayerState,
  type WhisperMessage,
} from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { onValidated } from './validated.js';

const authOf = (client: Client) => client.auth as AuthedUser;

/** Server time for clients' synced clocks (radio, group-table timers). */
export const clockNow = (): ClockMessage => ({ now: Date.now() });

/** Small allowance for movement between the client's range check and the server's. */
const WHISPER_SLACK_PX = 16;

/**
 * Room chat, whispers, emotes and typing dots. Chat is rate-limited, cleaned and profanity-filtered on the server, with
 * recent history for late joiners. Whispers go only to the two players, and only while they
 * stand close together. Reports are stored from the server's own copy of a message, so a
 * client can't report words that were never said.
 */
export class ChatController {
  private history: ChatMessage[] = [];
  /** Recent whispers, kept only so recipients can report them. */
  private whispers: WhisperMessage[] = [];
  private lastSent = new Map<string, number>();
  private lastEmote = new Map<string, number>();

  constructor(
    private readonly room: Room,
    private readonly roomLabel: () => string,
    private readonly players: () => MapSchema<PlayerState>,
  ) {}

  register(): void {
    onValidated(this.room, ClientMsg.Whisper, whisperSendSchema, (client, msg) =>
      this.whisper(client, msg.to, msg.text),
    );
    onValidated(this.room, ClientMsg.Chat, chatSendSchema, (client, msg) =>
      this.send(client, msg.text),
    );
    onValidated(this.room, ClientMsg.ChatReport, chatReportSchema, (client, msg) => {
      void this.report(client, msg.messageId, msg.reason ?? null);
    });
    onValidated(this.room, ClientMsg.Emote, emoteSendSchema, (client, msg) => {
      const now = Date.now();
      if (now - (this.lastEmote.get(client.sessionId) ?? 0) < EMOTE_MIN_INTERVAL_MS) return;
      this.lastEmote.set(client.sessionId, now);
      const out: EmoteMessage = { sessionId: client.sessionId, emote: msg.emote };
      this.room.broadcast(ServerMsg.Emote, out);
    });
    onValidated(this.room, ClientMsg.Typing, typingSchema, (client, msg) => {
      const player = this.players().get(client.sessionId);
      if (player) player.typing = msg.typing;
    });
  }

  join(client: Client): void {
    if (this.history.length) client.send(ServerMsg.ChatHistory, this.history.slice(-CHAT_BACKLOG));
  }

  leave(client: Client): void {
    this.lastSent.delete(client.sessionId);
    this.lastEmote.delete(client.sessionId);
  }

  private notice(client: Client, message: string) {
    const notice: ChatNotice = { message };
    client.send(ServerMsg.ChatNotice, notice);
  }

  /** Shared rate limit for chat and whispers; returns the cleaned text or null. */
  private accept(client: Client, raw: string, now: number): string | null {
    const last = this.lastSent.get(client.sessionId) ?? 0;
    if (now - last < CHAT_MIN_INTERVAL_MS) {
      this.notice(client, 'Slow down a little: one message per second.');
      return null;
    }
    const text = filterProfanity(cleanChatText(raw));
    if (!text) return null;
    this.lastSent.set(client.sessionId, now);
    return text;
  }

  private whisper(client: Client, to: string, raw: string): void {
    const now = Date.now();
    if (to === client.sessionId) return;
    const target = this.room.clients.get(to);
    const me = this.players().get(client.sessionId);
    const them = this.players().get(to);
    if (!target || !me || !them) return this.notice(client, 'They are no longer here.');
    if (Math.hypot(me.x - them.x, me.y - them.y) > WHISPER_RANGE_PX + WHISPER_SLACK_PX) {
      return this.notice(client, `Walk closer to ${them.name} to whisper.`);
    }
    const text = this.accept(client, raw, now);
    if (!text) return;
    const from = authOf(client);
    const recipient = authOf(target);
    const message: WhisperMessage = {
      id: randomUUID(),
      sessionId: client.sessionId,
      userId: from.userId,
      name: from.username,
      text,
      at: now,
      to: { sessionId: to, userId: recipient.userId, name: recipient.username },
    };
    this.whispers.push(message);
    if (this.whispers.length > CHAT_HISTORY)
      this.whispers.splice(0, this.whispers.length - CHAT_HISTORY);
    client.send(ServerMsg.Whisper, message);
    target.send(ServerMsg.Whisper, message);
  }

  private send(client: Client, raw: string): void {
    const now = Date.now();
    const text = this.accept(client, raw, now);
    if (!text) return;
    const auth = authOf(client);
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId: client.sessionId,
      userId: auth.userId,
      name: auth.username,
      text,
      at: now,
    };
    this.history.push(message);
    if (this.history.length > CHAT_HISTORY)
      this.history.splice(0, this.history.length - CHAT_HISTORY);
    this.room.broadcast(ServerMsg.Chat, message);
  }

  private async report(client: Client, messageId: string, reason: string | null): Promise<void> {
    const reporter = authOf(client);
    // Whispers can only be reported by the person they were sent to.
    const message =
      this.history.find((m) => m.id === messageId) ??
      this.whispers.find((w) => w.id === messageId && w.to.userId === reporter.userId);
    if (!message) return this.notice(client, 'That message is too old to report.');
    if (message.userId === reporter.userId)
      return this.notice(client, 'You cannot report yourself.');
    try {
      const stored = await db().reportChat({
        reporterId: reporter.userId,
        reportedId: message.userId,
        room: 'to' in message ? `${this.roomLabel()} (whisper)` : this.roomLabel(),
        messageId,
        message: `${message.name}: ${message.text}`,
        reason,
      });
      this.notice(
        client,
        stored ? 'Thanks, the message was reported.' : 'You already reported that.',
      );
      log.info('chat message reported', {
        reporter: reporter.userId,
        reported: message.userId,
        messageId,
      });
    } catch (err) {
      log.error('chat report failed', { error: String(err) });
      this.notice(client, 'Could not report right now, please try again.');
    }
  }
}
