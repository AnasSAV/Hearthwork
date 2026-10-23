import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client } from 'colyseus';
import {
  canStand,
  ClientMsg,
  emptySchema,
  HOUSE_MAX_CLIENTS,
  houseCollisionGrid,
  houseJoinSchema,
  HouseState,
  houseWorld,
  moveSchema,
  PlacedItemState,
  PlayerState,
  RECONNECT_GRACE_SEC,
  ServerMsg,
  studySeats,
  TILE_SIZE,
  type CollisionGrid,
  type HouseDims,
  type HouseJoinOptions,
  type HouseNoticeMessage,
  type Vec2,
} from '@focus-town/shared';
import { authenticate, type AuthedUser } from '../auth.js';
import { db, type HouseRecord } from '../db.js';
import { FocusController, type DeskSpot } from '../focus/FocusController.js';
import { focusRegistry } from '../focus/registry.js';
import { houseEvents } from '../houseEvents.js';
import { log } from '../log.js';
import { ChatController, clockNow } from './ChatController.js';
import { correct, MovementGuard } from './MovementGuard.js';
import { registerProfileReload } from './profileReload.js';
import { onValidated, rejectUnknownMessages } from './validated.js';

const authOf = (client: Client) => client.auth as AuthedUser;

const VISIBILITY_REFUSAL: Record<HouseRecord['visibility'], string> = {
  public: 'You cannot visit this house right now.',
  friends: 'Only friends can visit this house.',
  private: 'This house is private.',
};

/**
 * One player's house. Created when the first person walks in (owner or visitor), disposed
 * when the last one leaves. All layout data lives in Postgres; this room only mirrors it.
 */
export class HouseRoom extends Room<{ state: HouseState }> {
  override maxClients = HOUSE_MAX_CLIENTS;
  override state = new HouseState();

  private dims: HouseDims = { width: 8, height: 6, rooms: 1 };
  private grid: CollisionGrid = houseCollisionGrid(this.dims, []);
  private seats = new Map<string, DeskSpot>();
  private visibility: HouseRecord['visibility'] = 'friends';

  private moves = new MovementGuard(
    () => this.grid,
    () => this.clock.currentTime,
  );
  private chat = new ChatController(
    this,
    () => `house:${this.state.ownerId}`,
    () => this.state.players,
  );
  private focus = new FocusController(this, () => this.state.players, {
    get: (id) => this.seats.get(id),
    isAt: (desk, pos) =>
      Math.abs(pos.x - desk.seat.x) <= TILE_SIZE / 2 &&
      Math.abs(pos.y - desk.seat.y) <= TILE_SIZE / 2,
  });

  override async onCreate(options: HouseJoinOptions): Promise<void> {
    const parsed = houseJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Invalid house');
    this.state.ownerId = parsed.data.ownerId;
    if (!(await this.reload())) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'No such house');

    onValidated(this, ClientMsg.Move, moveSchema, (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.moves.handle(client, player, msg, this.focus.isSeated(client.sessionId));
    });
    onValidated(this, ClientMsg.HouseReload, emptySchema, (client) => {
      if (authOf(client).userId !== this.state.ownerId) return;
      void this.reload().then(() => houseEvents.emit('changed', this.state.ownerId));
    });
    this.focus.register();
    this.chat.register();
    registerProfileReload(this, () => this.state.players);
    rejectUnknownMessages(this);
    this.clock.setInterval(() => this.broadcast(ServerMsg.Clock, clockNow()), 30_000);
    this.clock.setInterval(() => {
      this.state.focusingNow = focusRegistry.count();
    }, 2_000);
    log.info('house room created', { roomId: this.roomId, ownerId: this.state.ownerId });
  }

  override async onAuth(
    _client: Client,
    _options: unknown,
    context: AuthContext,
  ): Promise<AuthedUser> {
    const user = await authenticate(context);
    if (
      user.userId !== this.state.ownerId &&
      !(await db().canVisit(user.userId, this.state.ownerId))
    ) {
      throw new ServerError(ErrorCode.AUTH_FAILED, VISIBILITY_REFUSAL[this.visibility]);
    }
    return user;
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
    player.dir = 'up';
    player.moving = false;
    player.status = 'walking';
    player.focusMin = 0;
    this.state.players.set(client.sessionId, player);
    this.moves.join(client.sessionId);
    client.send(ServerMsg.Wallet, auth.wallet);
    client.send(ServerMsg.Clock, clockNow());
    this.chat.join(client);
    log.info('house visitor joined', {
      roomId: this.roomId,
      ownerId: this.state.ownerId,
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
    if (player) player.status = this.focus.isSeated(client.sessionId) ? 'focusing' : 'walking';
    this.moves.reset(client.sessionId);
  }

  override async onLeave(client: Client): Promise<void> {
    this.state.players.delete(client.sessionId);
    this.moves.leave(client.sessionId);
    this.chat.leave(client);
    await this.focus.leave(client);
  }

  override onDispose(): void {
    log.info('house room disposed', { roomId: this.roomId, ownerId: this.state.ownerId });
  }

  /**
   * Re-read the house from Postgres (after the owner saved a layout, upgraded or changed
   * settings) and bring everyone inside up to date. Returns false if the house doesn't exist.
   */
  private async reload(): Promise<boolean> {
    let house: HouseRecord | null;
    try {
      house = await db().getHouse(this.state.ownerId);
    } catch (err) {
      log.error('could not load house', { ownerId: this.state.ownerId, error: String(err) });
      return false;
    }
    if (!house) return false;

    this.dims = { width: house.width, height: house.height, rooms: house.rooms };
    this.visibility = house.visibility;
    const s = this.state;
    s.ownerName = house.ownerName;
    s.level = house.level;
    s.width = house.width;
    s.height = house.height;
    s.rooms = house.rooms;
    s.wallpaper = house.wallpaper ?? '';
    s.floor = house.floor ?? '';
    s.visibility = house.visibility;
    s.exteriorStyle = house.exteriorStyle;
    s.items.clear();
    for (const item of house.items) {
      const st = new PlacedItemState();
      st.id = item.id;
      st.itemId = item.itemId;
      st.room = item.room;
      st.x = item.x;
      st.y = item.y;
      s.items.push(st);
    }

    const placements = house.items.map((i) => ({ ...i, rotation: 0 }));
    this.grid = houseCollisionGrid(this.dims, placements);
    this.seats = new Map(
      studySeats(this.dims, placements).map((seat) => [
        seat.id,
        {
          id: seat.id,
          seat: {
            x: seat.tile.x * TILE_SIZE + TILE_SIZE / 2,
            y: seat.tile.y * TILE_SIZE + TILE_SIZE - 2,
          },
          facing: 'up' as const,
        },
      ]),
    );

    await this.focus.endMissingDesks();
    await this.applyToOccupants();
    return true;
  }

  /** After a reload: free anyone now stuck in furniture, and see out visitors who lost access. */
  private async applyToOccupants(): Promise<void> {
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player) continue;
      if (!this.focus.isSeated(client.sessionId) && !canStand(this.grid, player.x, player.y)) {
        const spawn = this.findSpawn();
        player.x = spawn.x;
        player.y = spawn.y;
        this.moves.reset(client.sessionId);
        correct(client, player);
      }
      const userId = authOf(client).userId;
      if (userId === this.state.ownerId) continue;
      if (!(await db().canVisit(userId, this.state.ownerId))) {
        const notice: HouseNoticeMessage = {
          message: `${this.state.ownerName} closed their house to visitors.`,
          leave: true,
        };
        client.send(ServerMsg.HouseNotice, notice);
      }
    }
  }

  private findSpawn(): Vec2 {
    const spawn = houseWorld.spawn(this.dims);
    return canStand(this.grid, spawn.x, spawn.y) ? spawn : { ...spawn, y: spawn.y + 8 };
  }
}
