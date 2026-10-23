import type { MapSchema } from '@colyseus/schema';
import type { Client, Room } from 'colyseus';
import {
  ClientMsg,
  emptySchema,
  focusBeatSchema,
  focusStartSchema,
  ServerMsg,
  type Direction,
  type FocusErrorMessage,
  type FocusStartMessage,
  type PlayerState,
  type Vec2,
} from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { correct } from '../rooms/MovementGuard.js';
import { onValidated } from '../rooms/validated.js';
import { FocusSession, type FocusSink } from './FocusSession.js';
import { focusRegistry } from './registry.js';

/** A place a player can sit and focus: a town desk or a desk/table inside a house. */
export interface DeskSpot {
  id: string;
  /** Where the seated player's feet go. */
  seat: Vec2;
  facing: Direction;
}

export interface DeskSource {
  get(id: string): DeskSpot | undefined;
  /** Is a player with feet at `pos` close enough to sit here? */
  isAt(desk: DeskSpot, pos: Vec2): boolean;
}

const authOf = (client: Client) => client.auth as AuthedUser;

/**
 * Focus sessions inside one room: seating, the `focus:*` messages and routing session events
 * back to the right client. Shared by TownRoom and HouseRoom.
 */
export class FocusController {
  /** Desk each focusing client sits at (by Colyseus sessionId). */
  private seated = new Map<string, string>();
  /** Clients with a focus:start in flight, so double-clicks can't start two sessions. */
  private starting = new Set<string>();

  constructor(
    private readonly room: Room,
    private readonly players: () => MapSchema<PlayerState>,
    private readonly desks: DeskSource,
  ) {}

  register(): void {
    onValidated(this.room, ClientMsg.FocusStart, focusStartSchema, (client, msg) => {
      void this.start(client, msg);
    });
    onValidated(this.room, ClientMsg.FocusBeat, focusBeatSchema, (client, msg) => {
      this.ownedSession(client)?.beat(msg, Date.now());
    });
    onValidated(this.room, ClientMsg.FocusConfirm, emptySchema, (client) => {
      this.ownedSession(client)?.confirmPresence();
    });
    onValidated(this.room, ClientMsg.FocusEnd, emptySchema, (client) => {
      void this.ownedSession(client)?.end('ended');
    });
  }

  isSeated(sessionId: string): boolean {
    return this.seated.has(sessionId);
  }

  /** Leaving the room closes the focus session (and pays out what was verified). */
  async leave(client: Client): Promise<void> {
    this.seated.delete(client.sessionId);
    await this.ownedSession(client)?.end('left');
  }

  /** End sessions whose desk no longer exists (e.g. the owner moved the furniture). */
  async endMissingDesks(): Promise<void> {
    for (const [sessionId, deskId] of this.seated) {
      if (this.desks.get(deskId)) continue;
      const client = this.room.clients.get(sessionId);
      if (client) await this.ownedSession(client)?.end('ended');
    }
  }

  /** The focus session owned by this client (not another tab of the same user). */
  ownedSession(client: Client): FocusSession | undefined {
    const session = focusRegistry.get(authOf(client).userId);
    return session && session.ownerClientId === client.sessionId ? session : undefined;
  }

  private error(client: Client, message: string) {
    const msg: FocusErrorMessage = { message };
    client.send(ServerMsg.FocusError, msg);
  }

  private async start(client: Client, msg: FocusStartMessage): Promise<void> {
    const auth = authOf(client);
    const player = this.players().get(client.sessionId);
    if (!player || this.starting.has(client.sessionId)) return;
    if (this.ownedSession(client)) return this.error(client, 'You are already focusing.');

    const desk = this.desks.get(msg.deskId);
    if (!desk) return this.error(client, 'That desk does not exist.');
    if (!this.desks.isAt(desk, player)) return this.error(client, 'Walk up to the desk first.');
    for (const [sessionId, deskId] of this.seated) {
      if (deskId === desk.id && sessionId !== client.sessionId) {
        return this.error(client, 'Someone is already sitting there.');
      }
    }

    this.starting.add(client.sessionId);
    try {
      // One session per user: starting here ends the one in any other tab or room.
      await focusRegistry.get(auth.userId)?.end('replaced');

      const session = await FocusSession.start({
        db: db(),
        userId: auth.userId,
        deskId: desk.id,
        plannedMin: msg.plannedMin,
        audioOnly: msg.audioOnly,
        sink: this.sinkFor(client.sessionId),
        now: Date.now,
      });
      if (!this.room.clients.get(client.sessionId)) {
        await session.end('left'); // the player left while we were talking to the database
        return;
      }
      focusRegistry.set(session);
      this.seated.set(client.sessionId, desk.id);
      player.x = desk.seat.x;
      player.y = desk.seat.y;
      player.dir = desk.facing;
      player.moving = false;
      player.status = 'focusing';
      player.focusMin = 0;
      correct(client, player);
      log.info('focus session started', {
        roomId: this.room.roomId,
        userId: auth.userId,
        sessionId: session.sessionId,
        desk: desk.id,
        plannedMin: msg.plannedMin,
        audioOnly: msg.audioOnly,
      });
    } catch (err) {
      log.error('focus start failed', { userId: auth.userId, error: String(err) });
      this.error(client, 'Could not start a focus session. Please try again.');
    } finally {
      this.starting.delete(client.sessionId);
    }
  }

  /** Routes a focus session's messages to its client, looked up at send time (survives reconnects). */
  private sinkFor(clientSessionId: string): FocusSink {
    return {
      clientSessionId,
      state: (m) => {
        this.room.clients.get(clientSessionId)?.send(ServerMsg.FocusState, m);
        const player = this.players().get(clientSessionId);
        if (player) player.focusMin = m.verifiedMin;
      },
      wallet: (m) => this.room.clients.get(clientSessionId)?.send(ServerMsg.Wallet, m),
      ended: (m) => {
        this.room.clients.get(clientSessionId)?.send(ServerMsg.FocusEnded, m);
        this.seated.delete(clientSessionId);
        const player = this.players().get(clientSessionId);
        if (player) {
          if (player.status === 'focusing') player.status = 'walking';
          player.focusMin = 0;
        }
      },
    };
  }
}
