import { randomUUID } from 'node:crypto';
import type { Client, Room } from 'colyseus';
import {
  CHAT_BACKLOG,
  CHAT_HISTORY,
  CHAT_MIN_INTERVAL_MS,
  ClientMsg,
  chatReportSchema,
  chatSendSchema,
  cleanChatText,
  filterProfanity,
  ServerMsg,
  type ChatMessage,
  type ChatNotice,
  type ClockMessage,
} from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { onValidated } from './validated.js';

const authOf = (client: Client) => client.auth as AuthedUser;

/** Server time for clients' synced clocks (radio, group-table timers). */
export const clockNow = (): ClockMessage => ({ now: Date.now() });

/**
 * Room chat: rate-limited, cleaned and profanity-filtered on the server, with recent history for
 * late joiners. Reports are stored from the server's own copy of the message, so a client can't
 * report words that were never said.
 */
export class ChatController {
  private history: ChatMessage[] = [];
  private lastSent = new Map<string, number>();

  constructor(
    private readonly room: Room,
    private readonly roomLabel: () => string,
  ) {}

  register(): void {
    onValidated(this.room, ClientMsg.Chat, chatSendSchema, (client, msg) =>
      this.send(client, msg.text),
    );
    onValidated(this.room, ClientMsg.ChatReport, chatReportSchema, (client, msg) => {
      void this.report(client, msg.messageId, msg.reason ?? null);
    });
  }

  join(client: Client): void {
    if (this.history.length) client.send(ServerMsg.ChatHistory, this.history.slice(-CHAT_BACKLOG));
  }

  leave(client: Client): void {
    this.lastSent.delete(client.sessionId);
  }

  private notice(client: Client, message: string) {
    const notice: ChatNotice = { message };
    client.send(ServerMsg.ChatNotice, notice);
  }

  private send(client: Client, raw: string): void {
    const now = Date.now();
    const last = this.lastSent.get(client.sessionId) ?? 0;
    if (now - last < CHAT_MIN_INTERVAL_MS) {
      this.notice(client, 'Slow down a little: one message per second.');
      return;
    }
    const text = filterProfanity(cleanChatText(raw));
    if (!text) return;
    this.lastSent.set(client.sessionId, now);
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
    const message = this.history.find((m) => m.id === messageId);
    if (!message) return this.notice(client, 'That message is too old to report.');
    const reporter = authOf(client);
    if (message.userId === reporter.userId)
      return this.notice(client, 'You cannot report yourself.');
    try {
      const stored = await db().reportChat({
        reporterId: reporter.userId,
        reportedId: message.userId,
        room: this.roomLabel(),
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
