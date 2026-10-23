import { CloseCode, Room, type AuthContext, type Client } from 'colyseus';
import {
  canStand,
  ClientMsg,
  emptySchema,
  focusBeatSchema,
  focusStartSchema,
  moveSchema,
  MOVE_MIN_INTERVAL_MS,
  PlayerState,
  RECONNECT_GRACE_SEC,
  ServerMsg,
  TOWN_MAX_CLIENTS,
  TownState,
  validateMove,
  type FocusErrorMessage,
  type FocusStartMessage,
  type MoveCorrectMessage,
  type MoveMessage,
  type Vec2,
} from '@focus-town/shared';
import { authenticate, type AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { FocusSession, type FocusSink } from '../focus/FocusSession.js';
import { focusRegistry } from '../focus/registry.js';
import { log } from '../log.js';
import { isAtDesk, townMap } from '../maps.js';
import { onValidated, rejectUnknownMessages } from './validated.js';

interface MoveTrack {
  /** Server clock (ms) when the last move was accepted. */
  at: number;
  /** Server clock (ms) when the last move message arrived, accepted or not. */
  receivedAt: number;
}

const authOf = (client: Client) => client.auth as AuthedUser;

export class TownRoom extends Room<{ state: TownState }> {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();

  private moves = new Map<string, MoveTrack>();
  /** Desk each focusing client sits at (by Colyseus sessionId). */
  private seated = new Map<string, string>();
  /** Clients with a focus:start in flight, so double-clicks can't start two sessions. */
  private starting = new Set<string>();

  override onCreate(): void {
    onValidated(this, ClientMsg.Move, moveSchema, (client, msg) => this.handleMove(client, msg));
    onValidated(this, ClientMsg.FocusStart, focusStartSchema, (client, msg) => {
      void this.startFocus(client, msg);
    });
    onValidated(this, ClientMsg.FocusBeat, focusBeatSchema, (client, msg) => {
      this.ownedSession(client)?.beat(msg, Date.now());
    });
    onValidated(this, ClientMsg.FocusConfirm, emptySchema, (client) => {
      this.ownedSession(client)?.confirmPresence();
    });
    onValidated(this, ClientMsg.FocusEnd, emptySchema, (client) => {
      void this.ownedSession(client)?.end('ended');
    });
    rejectUnknownMessages(this);

    this.clock.setInterval(() => {
      this.state.focusingNow = focusRegistry.count();
    }, 2_000);
    log.info('town room created', { roomId: this.roomId });
  }

  override onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<AuthedUser> {
    return authenticate(context);
  }

  override onJoin(client: Client): void {
    const auth = authOf(client);
    const spawn = this.findSpawn();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = auth.username;
    player.avatar = auth.avatarBody;
    player.x = spawn.x;
    player.y = spawn.y;
    player.dir = 'down';
    player.moving = false;
    player.status = 'walking';
    player.focusMin = 0;
    this.state.players.set(client.sessionId, player);
    this.moves.set(client.sessionId, { at: this.clock.currentTime, receivedAt: 0 });
    client.send(ServerMsg.Wallet, auth.wallet);
    log.info('player joined', {
      roomId: this.roomId,
      sessionId: client.sessionId,
      userId: auth.userId,
      name: auth.username,
    });
  }

  override onDrop(client: Client, code?: number): void {
    // 1001 "going away" is the browser closing or navigating the tab. That's a deliberate
    // exit even if the client's own leave message didn't make it out, so don't hold the seat.
    // Returning without allowReconnection() makes Colyseus call onLeave right away.
    if (code === CloseCode.GOING_AWAY) return;

    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.moving = false;
      player.status = 'away';
    }
    // On timeout the promise rejects and Colyseus calls onLeave, which cleans up.
    this.allowReconnection(client, RECONNECT_GRACE_SEC).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.status = this.seated.has(client.sessionId) ? 'focusing' : 'walking';
    const track = this.moves.get(client.sessionId);
    if (track) track.at = this.clock.currentTime;
    log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
  }

  override async onLeave(client: Client): Promise<void> {
    this.state.players.delete(client.sessionId);
    this.moves.delete(client.sessionId);
    this.seated.delete(client.sessionId);
    log.info('player left', { roomId: this.roomId, sessionId: client.sessionId });
    // Leaving closes the focus session (and pays out what was verified).
    await this.ownedSession(client)?.end('left');
  }

  override onDispose(): void {
    log.info('town room disposed', { roomId: this.roomId });
  }

  // -------------------------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------------------------

  private handleMove(client: Client, msg: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    const track = this.moves.get(client.sessionId);
    if (!player || !track) return;

    const now = this.clock.currentTime;
    // Rate limit: the client sends ≤10/s; anything faster is dropped (positions are absolute,
    // so the next message carries the information anyway).
    if (now - track.receivedAt < MOVE_MIN_INTERVAL_MS) return;
    track.receivedAt = now;

    // Seated players stay put until they end their session.
    if (this.seated.has(client.sessionId)) {
      if (msg.x !== player.x || msg.y !== player.y) this.correct(client, player);
      return;
    }

    const from = { x: player.x, y: player.y };
    const check = validateMove(townMap.grid, from, msg, now - track.at);
    if (!check.ok) {
      log.warn('move rejected', {
        sessionId: client.sessionId,
        reason: check.reason,
        from,
        to: { x: msg.x, y: msg.y },
      });
      this.correct(client, player);
      return;
    }

    player.x = msg.x;
    player.y = msg.y;
    player.dir = msg.dir;
    player.moving = msg.moving;
    track.at = now;
  }

  private correct(client: Client, player: PlayerState) {
    const correction: MoveCorrectMessage = { x: player.x, y: player.y };
    client.send(ServerMsg.MoveCorrect, correction);
  }

  /** The map spawn point, nudged a little so players don't stack perfectly. */
  private findSpawn(): Vec2 {
    const base = townMap.spawn;
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = base.x + Math.round((Math.random() - 0.5) * 24);
      const y = base.y + Math.round((Math.random() - 0.5) * 12);
      if (canStand(townMap.grid, x, y)) return { x, y };
    }
    return { ...base };
  }

  // -------------------------------------------------------------------------------------------
  // Focus sessions
  // -------------------------------------------------------------------------------------------

  /** The focus session owned by this client (not another tab of the same user). */
  private ownedSession(client: Client): FocusSession | undefined {
    const session = focusRegistry.get(authOf(client).userId);
    return session && session.ownerClientId === client.sessionId ? session : undefined;
  }

  private focusError(client: Client, message: string) {
    const msg: FocusErrorMessage = { message };
    client.send(ServerMsg.FocusError, msg);
  }

  private async startFocus(client: Client, msg: FocusStartMessage): Promise<void> {
    const auth = authOf(client);
    const player = this.state.players.get(client.sessionId);
    if (!player || this.starting.has(client.sessionId)) return;
    if (this.ownedSession(client)) return this.focusError(client, 'You are already focusing.');

    const desk = townMap.desks.get(msg.deskId);
    if (!desk) return this.focusError(client, 'That desk does not exist.');
    if (!isAtDesk(desk, player)) return this.focusError(client, 'Walk up to the desk first.');
    for (const [sessionId, deskId] of this.seated) {
      if (deskId === desk.id && sessionId !== client.sessionId) {
        return this.focusError(client, 'Someone is already sitting there.');
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
      if (!this.clients.get(client.sessionId)) {
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
      client.send(ServerMsg.MoveCorrect, { x: player.x, y: player.y } satisfies MoveCorrectMessage);
      log.info('focus session started', {
        userId: auth.userId,
        sessionId: session.sessionId,
        desk: desk.id,
        plannedMin: msg.plannedMin,
        audioOnly: msg.audioOnly,
      });
    } catch (err) {
      log.error('focus start failed', { userId: auth.userId, error: String(err) });
      this.focusError(client, 'Could not start a focus session. Please try again.');
    } finally {
      this.starting.delete(client.sessionId);
    }
  }

  /** Routes a focus session's messages to its client, looked up at send time (survives reconnects). */
  private sinkFor(clientSessionId: string): FocusSink {
    return {
      clientSessionId,
      state: (m) => {
        this.clients.get(clientSessionId)?.send(ServerMsg.FocusState, m);
        const player = this.state.players.get(clientSessionId);
        if (player) player.focusMin = m.verifiedMin;
      },
      wallet: (m) => this.clients.get(clientSessionId)?.send(ServerMsg.Wallet, m),
      ended: (m) => {
        this.clients.get(clientSessionId)?.send(ServerMsg.FocusEnded, m);
        this.seated.delete(clientSessionId);
        const player = this.state.players.get(clientSessionId);
        if (player) {
          if (player.status === 'focusing') player.status = 'walking';
          player.focusMin = 0;
        }
      },
    };
  }
}
