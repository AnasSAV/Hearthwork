import { CloseCode, Room, type AuthContext, type Client } from 'colyseus';
import {
  canStand,
  ClientMsg,
  emptySchema,
  GAME_MAX_CLIENTS,
  gameJoinSchema,
  GameState,
  moveSchema,
  PlayerState,
  RAFT_SPEED,
  RECONNECT_GRACE_SEC,
  ServerMsg,
  type GameEvent,
  type GameId,
  type Vec2,
} from '@focus-town/shared';
import { authenticate, type AuthedUser } from '../auth.js';
import { focusRegistry } from '../focus/registry.js';
import { log } from '../log.js';
import { gameMaps, type GameMap } from '../maps.js';
import { ChatController, clockNow } from '../rooms/ChatController.js';
import { correct, MovementGuard } from '../rooms/MovementGuard.js';
import { SocialController } from '../rooms/SocialController.js';
import { registerProfileReload } from '../rooms/profileReload.js';
import { onValidated, rejectUnknownMessages } from '../rooms/validated.js';
import { ButterflyGame } from './butterflies.js';
import { FishingGame } from './fishing.js';
import type { GameContext, GameLogic } from './logic.js';
import { PlayController } from './PlayController.js';
import { RaftingGame } from './rafting.js';
import { TreasureGame } from './treasure.js';

const authOf = (client: Client) => client.auth as AuthedUser;

/** One instance of a mini-game's map: walking and chat like the town, plus that game's rules. */
export class GameRoom extends Room<{ state: GameState }> {
  override maxClients = GAME_MAX_CLIENTS;
  override state = new GameState();

  private map!: GameMap;
  private logic!: GameLogic;
  private play!: PlayController;
  private walk!: MovementGuard;
  /** On a raft, moves are checked against the water at raft speed. */
  private raft: MovementGuard | null = null;
  private chat!: ChatController;
  private social = new SocialController(this, () => this.state.players);

  override onCreate(options: unknown): void {
    const { game } = gameJoinSchema.parse(options);
    this.map = gameMaps[game];
    const now = () => this.clock.currentTime;
    this.play = new PlayController(game, Date.now);
    this.walk = new MovementGuard(() => this.map.grid, now);
    if (this.map.raftGrid) {
      const grid = this.map.raftGrid;
      this.raft = new MovementGuard(
        () => grid,
        now,
        () => RAFT_SPEED,
      );
    }
    this.logic = this.createLogic(game);
    this.chat = new ChatController(
      this,
      () => `${game}:${this.roomId}`,
      () => this.state.players,
    );

    onValidated(this, ClientMsg.Move, moveSchema, (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const guard = player.mode === 'raft' && this.raft ? this.raft : this.walk;
      const before = { x: player.x, y: player.y };
      guard.handle(client, player, msg, this.logic.locked(client.sessionId));
      if (player.x !== before.x || player.y !== before.y) this.logic.moved?.(client, player);
    });
    onValidated(this, ClientMsg.GameUse, emptySchema, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.logic.use(client, player);
    });
    this.chat.register();
    this.social.register();
    registerProfileReload(this, () => this.state.players);
    rejectUnknownMessages(this);

    this.clock.setInterval(() => {
      this.logic.tick(Date.now());
    }, 100);
    this.clock.setInterval(() => this.play.tick(Date.now()), 1_000);
    this.clock.setInterval(() => this.broadcast(ServerMsg.Clock, clockNow()), 30_000);
    this.clock.setInterval(() => {
      this.state.focusingNow = focusRegistry.count();
    }, 2_000);
    log.info('game room created', { roomId: this.roomId, game });
  }

  private createLogic(game: GameId): GameLogic {
    const ctx: GameContext = {
      now: Date.now,
      random: Math.random,
      send: (client: Client, event: GameEvent) => client.send(ServerMsg.GameEvent, event),
      played: (client) => this.play.played(client),
      score: (client, points, note) => this.play.score(client, points, note),
      teleport: (client, player, to) => this.teleport(client, player, to),
    };
    const m = this.map;
    switch (game) {
      case 'fishing':
        return new FishingGame(ctx, m.fishZones, m.water);
      case 'rafting': {
        const { launch, start, finish } = m;
        if (!launch || !start || !finish) throw new Error('rapids map is incomplete');
        return new RaftingGame(ctx, { launch, start, finish, buoys: m.buoys, bank: m.spawn });
      }
      case 'butterflies':
        return new ButterflyGame(ctx, () => this.state.critters, m.bounds, m.flowers);
      case 'treasure':
        if (!m.digZone) throw new Error('cove map has no dig zone');
        return new TreasureGame(ctx, m.digZone, m.grid);
    }
  }

  private teleport(client: Client, player: PlayerState, to: Vec2): void {
    player.x = to.x;
    player.y = to.y;
    player.moving = false;
    this.walk.reset(client.sessionId);
    this.raft?.reset(client.sessionId);
    correct(client, player);
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
    player.avatar = auth.avatar;
    player.x = spawn.x;
    player.y = spawn.y;
    player.dir = 'down';
    player.moving = false;
    player.status = 'walking';
    player.focusMin = 0;
    player.mode = '';
    player.castX = 0;
    player.castY = 0;
    this.state.players.set(client.sessionId, player);
    this.walk.join(client.sessionId);
    this.raft?.join(client.sessionId);
    this.play.join(client);
    this.logic.join(client, player);
    client.send(ServerMsg.Wallet, auth.wallet);
    client.send(ServerMsg.Clock, clockNow());
    this.chat.join(client);
    this.social.join(client);
    log.info('player joined game', {
      roomId: this.roomId,
      room: this.roomName,
      userId: auth.userId,
      name: auth.username,
    });
  }

  override onDrop(client: Client, code?: number): void {
    if (code === CloseCode.GOING_AWAY) return;
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.moving = false;
      player.status = 'away';
    }
    this.allowReconnection(client, RECONNECT_GRACE_SEC).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.status = 'walking';
    this.walk.reset(client.sessionId);
    this.raft?.reset(client.sessionId);
  }

  override async onLeave(client: Client): Promise<void> {
    this.state.players.delete(client.sessionId);
    this.walk.leave(client.sessionId);
    this.raft?.leave(client.sessionId);
    this.logic.leave(client);
    this.chat.leave(client);
    this.social.leave(client);
    await this.play.leave(client);
    log.info('player left game', { roomId: this.roomId, sessionId: client.sessionId });
  }

  private findSpawn(): Vec2 {
    const base = this.map.spawn;
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = base.x + Math.round((Math.random() - 0.5) * 24);
      const y = base.y + Math.round((Math.random() - 0.5) * 12);
      if (canStand(this.map.grid, x, y)) return { x, y };
    }
    return { ...base };
  }
}
