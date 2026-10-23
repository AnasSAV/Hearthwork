import { CloseCode, Room, type Client } from 'colyseus';
import {
  canStand,
  ClientMsg,
  moveSchema,
  MOVE_MIN_INTERVAL_MS,
  PlayerState,
  RECONNECT_GRACE_SEC,
  ServerMsg,
  TOWN_MAX_CLIENTS,
  townJoinOptionsSchema,
  TownState,
  validateMove,
  type MoveCorrectMessage,
  type TownJoinOptions,
  type Vec2,
} from '@focus-town/shared';
import { log } from '../log.js';
import { townMap } from '../maps.js';
import { onValidated, rejectUnknownMessages } from './validated.js';

interface MoveTrack {
  /** Server clock (ms) when the last move was accepted. */
  at: number;
  /** Server clock (ms) when the last move message arrived, accepted or not. */
  receivedAt: number;
}

export class TownRoom extends Room<{ state: TownState }> {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();

  private moves = new Map<string, MoveTrack>();

  override onCreate(): void {
    onValidated(this, ClientMsg.Move, moveSchema, (client, msg) => this.handleMove(client, msg));
    rejectUnknownMessages(this);
    log.info('town room created', { roomId: this.roomId });
  }

  /**
   * Phase 1: guests pick a name/avatar in join options (validated). Phase 2 replaces this
   * with Supabase JWT verification and loads the profile from Postgres.
   */
  override onAuth(_client: Client, options: unknown): TownJoinOptions {
    const parsed = townJoinOptionsSchema.safeParse(options);
    if (!parsed.success) {
      log.warn('join rejected: invalid options', { issues: parsed.error.issues.length });
      throw new Error('Invalid join options');
    }
    return parsed.data;
  }

  override onJoin(client: Client): void {
    const auth = client.auth as TownJoinOptions;
    const spawn = this.findSpawn();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = auth.name;
    player.avatar = auth.avatar;
    player.x = spawn.x;
    player.y = spawn.y;
    player.dir = 'down';
    player.moving = false;
    player.status = 'walking';
    player.focusMin = 0;
    this.state.players.set(client.sessionId, player);
    const now = this.clock.currentTime;
    this.moves.set(client.sessionId, { at: now, receivedAt: 0 });
    log.info('player joined', {
      roomId: this.roomId,
      sessionId: client.sessionId,
      name: auth.name,
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
    if (player) player.status = 'walking';
    const track = this.moves.get(client.sessionId);
    if (track) track.at = this.clock.currentTime;
    log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.moves.delete(client.sessionId);
    log.info('player left', { roomId: this.roomId, sessionId: client.sessionId });
  }

  override onDispose(): void {
    log.info('town room disposed', { roomId: this.roomId });
  }

  private handleMove(
    client: Client,
    msg: { x: number; y: number; dir: PlayerState['dir']; moving: boolean },
  ) {
    const player = this.state.players.get(client.sessionId);
    const track = this.moves.get(client.sessionId);
    if (!player || !track) return;

    const now = this.clock.currentTime;
    // Rate limit: the client sends ≤10/s; anything faster is dropped (positions are absolute,
    // so the next message carries the information anyway).
    if (now - track.receivedAt < MOVE_MIN_INTERVAL_MS) return;
    track.receivedAt = now;

    const from = { x: player.x, y: player.y };
    const check = validateMove(townMap.grid, from, msg, now - track.at);
    if (!check.ok) {
      log.warn('move rejected', {
        sessionId: client.sessionId,
        reason: check.reason,
        from,
        to: { x: msg.x, y: msg.y },
      });
      const correction: MoveCorrectMessage = { x: player.x, y: player.y };
      client.send(ServerMsg.MoveCorrect, correction);
      return;
    }

    player.x = msg.x;
    player.y = msg.y;
    player.dir = msg.dir;
    player.moving = msg.moving;
    track.at = now;
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
}
