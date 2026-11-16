import type { MapSchema } from '@colyseus/schema';
import type { Client, Room } from 'colyseus';
import {
  ClientMsg,
  emptySchema,
  PINCH_EVERY_MS,
  PINCH_SAME_FRIEND_EVERY_MS,
  pinchSchema,
  ServerMsg,
  type FriendsOnlineMessage,
  type NoticeMessage,
  type PinchedMessage,
  type PlayerState,
} from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { onValidated } from './validated.js';

/**
 * Who is online anywhere on this server (any room), for friends' online dots and pinches. Only
 * a convenience: after a restart it fills up again as players reconnect.
 */
const online = new Map<string, Map<string, { client: Client; name: () => string }>>();
/** Friend lists, briefly cached so the friends panel and pinches don't hit the database often. */
const friendCache = new Map<string, { ids: Set<string>; at: number }>();
const FRIEND_CACHE_MS = 30_000;
const lastPinchBy = new Map<string, number>();
const lastPinchPair = new Map<string, number>();

const authOf = (client: Client) => client.auth as AuthedUser;

async function friendsOf(userId: string, fresh = false): Promise<Set<string>> {
  const cached = friendCache.get(userId);
  if (!fresh && cached && Date.now() - cached.at < FRIEND_CACHE_MS) return cached.ids;
  const ids = new Set(await db().friendIds(userId));
  friendCache.set(userId, { ids, at: Date.now() });
  return ids;
}

function notice(client: Client, message: string): void {
  const msg: NoticeMessage = { message };
  client.send(ServerMsg.Notice, msg);
}

/** Online status and pinches between friends, wherever each of them is. Shared by every room. */
export class SocialController {
  constructor(
    private readonly room: Room,
    private readonly players: () => MapSchema<PlayerState>,
  ) {}

  register(): void {
    onValidated(this.room, ClientMsg.FriendsOnline, emptySchema, (client) => {
      void this.sendOnlineFriends(client);
    });
    onValidated(this.room, ClientMsg.Pinch, pinchSchema, (client, msg) => {
      void this.pinch(client, msg.userId);
    });
  }

  join(client: Client): void {
    const auth = authOf(client);
    const sessions = online.get(auth.userId) ?? new Map();
    sessions.set(client.sessionId, {
      client,
      name: () => this.players().get(client.sessionId)?.name ?? auth.username,
    });
    online.set(auth.userId, sessions);
  }

  leave(client: Client): void {
    const { userId } = authOf(client);
    const sessions = online.get(userId);
    sessions?.delete(client.sessionId);
    if (sessions?.size === 0) online.delete(userId);
  }

  private async sendOnlineFriends(client: Client): Promise<void> {
    try {
      const friends = await friendsOf(authOf(client).userId, true);
      const msg: FriendsOnlineMessage = { online: [...friends].filter((id) => online.has(id)) };
      client.send(ServerMsg.FriendsOnline, msg);
    } catch (err) {
      log.error('friends online lookup failed', { error: String(err) });
    }
  }

  private async pinch(client: Client, targetId: string): Promise<void> {
    const from = authOf(client);
    const now = Date.now();
    if (targetId === from.userId) return notice(client, "You can't pinch yourself.");
    if (now - (lastPinchBy.get(from.userId) ?? 0) < PINCH_EVERY_MS) {
      return notice(client, 'Easy! One pinch at a time.');
    }
    const pair = `${from.userId}>${targetId}`;
    if (now - (lastPinchPair.get(pair) ?? 0) < PINCH_SAME_FRIEND_EVERY_MS) {
      return notice(client, 'You just pinched them. Give it a moment.');
    }
    let friends: Set<string>;
    try {
      friends = await friendsOf(from.userId);
      if (!friends.has(targetId)) friends = await friendsOf(from.userId, true);
    } catch (err) {
      log.error('pinch friend check failed', { error: String(err) });
      return notice(client, 'Could not pinch right now. Try again.');
    }
    if (!friends.has(targetId)) return notice(client, 'You can only pinch your friends.');
    const sessions = online.get(targetId);
    if (!sessions?.size) return notice(client, "They aren't online right now.");

    lastPinchBy.set(from.userId, now);
    lastPinchPair.set(pair, now);
    const senderName = online.get(from.userId)?.get(client.sessionId)?.name() ?? from.username;
    const msg: PinchedMessage = { fromId: from.userId, fromName: senderName };
    // Every tab they have open gets it.
    for (const s of sessions.values()) s.client.send(ServerMsg.Pinched, msg);
    const targetName = [...sessions.values()][0]!.name();
    notice(client, `You pinched ${targetName}!`);
    log.info('pinch', { from: from.userId, to: targetId });
  }
}
