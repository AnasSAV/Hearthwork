import type { MapSchema } from '@colyseus/schema';
import type { Client, Room } from 'colyseus';
import {
  ClientMsg,
  emptySchema,
  focusBeatSchema,
  focusStartSchema,
  ServerMsg,
  TABLE_GRACE_MS,
  TableTimerState,
  type Direction,
  type FocusBlock,
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

/** Group tables whose seats share one Pomodoro countdown (town only). */
export interface GroupTables {
  /** Table a desk belongs to, or null for a solo desk. */
  tableOf(deskId: string): string | null;
  timers(): MapSchema<TableTimerState>;
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
    private readonly tables?: GroupTables,
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

  /**
   * Called every second: refresh how many sit at each table, drop empty tables, and close a
   * table's sessions once its countdown (plus grace for the last heartbeat) is over.
   */
  tickTables(now: number): void {
    if (!this.tables) return;
    const seatedAt = this.countTables();
    for (const [tableId, timer] of [...this.tables.timers().entries()]) {
      const sessions = seatedAt.get(tableId) ?? [];
      if (sessions.length === 0) {
        this.tables.timers().delete(tableId);
      } else if (now >= timer.endsAt + TABLE_GRACE_MS) {
        this.tables.timers().delete(tableId);
        for (const sessionId of sessions) {
          const client = this.room.clients.get(sessionId);
          if (client) void this.ownedSession(client)?.end('table_finished');
        }
      }
    }
  }

  /** Update each table's seated count; returns table -> seated client ids. */
  private countTables(): Map<string, string[]> {
    const byTable = new Map<string, string[]>();
    if (!this.tables) return byTable;
    for (const [sessionId, deskId] of this.seated) {
      const tableId = this.tables.tableOf(deskId);
      if (tableId) byTable.set(tableId, [...(byTable.get(tableId) ?? []), sessionId]);
    }
    for (const [tableId, timer] of this.tables.timers()) {
      const n = byTable.get(tableId)?.length ?? 0;
      if (timer.seated !== n) timer.seated = n;
    }
    return byTable;
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

    // At a group table the first person picks the block; later arrivals join the same
    // countdown (and only get the completion bonus if they still verify the whole block).
    const now = Date.now();
    const tableId = this.tables?.tableOf(desk.id) ?? null;
    const timer = tableId && this.tables ? this.tables.timers().get(tableId) : undefined;
    const joiningTable = timer !== undefined && timer.endsAt > now;
    let plannedMin: FocusBlock | null = msg.plannedMin;
    if (tableId) plannedMin = joiningTable ? (timer.plannedMin as FocusBlock) : (plannedMin ?? 25);

    this.starting.add(client.sessionId);
    try {
      // One session per user: starting here ends the one in any other tab or room.
      await focusRegistry.get(auth.userId)?.end('replaced');

      const session = await FocusSession.start({
        db: db(),
        userId: auth.userId,
        deskId: desk.id,
        plannedMin,
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
      if (tableId && this.tables && !joiningTable && plannedMin) {
        const t = new TableTimerState();
        t.tableId = tableId;
        t.plannedMin = plannedMin;
        t.startedAt = now;
        t.endsAt = now + plannedMin * 60_000;
        this.tables.timers().set(tableId, t);
      }
      this.countTables();
      log.info('focus session started', {
        roomId: this.room.roomId,
        userId: auth.userId,
        sessionId: session.sessionId,
        desk: desk.id,
        plannedMin,
        table: tableId,
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
