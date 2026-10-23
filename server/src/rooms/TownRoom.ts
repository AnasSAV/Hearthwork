import { CloseCode, Room, type AuthContext, type Client } from 'colyseus';
import {
  canStand,
  ClientMsg,
  LotState,
  moveSchema,
  PlayerState,
  RECONNECT_GRACE_SEC,
  ServerMsg,
  TOWN_MAX_CLIENTS,
  townJoinSchema,
  TownState,
  type Vec2,
} from '@focus-town/shared';
import { authenticate, type AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { FocusController } from '../focus/FocusController.js';
import { focusRegistry } from '../focus/registry.js';
import { houseEvents } from '../houseEvents.js';
import { log } from '../log.js';
import { isAtDesk, townMap } from '../maps.js';
import { ChatController, clockNow } from './ChatController.js';
import { MovementGuard } from './MovementGuard.js';
import { registerProfileReload } from './profileReload.js';
import { onValidated, rejectUnknownMessages } from './validated.js';

const authOf = (client: Client) => client.auth as AuthedUser;

export class TownRoom extends Room<{ state: TownState }> {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();

  private moves = new MovementGuard(
    () => townMap.grid,
    () => this.clock.currentTime,
  );
  private focus = new FocusController(
    this,
    () => this.state.players,
    {
      get: (id) => townMap.desks.get(id),
      isAt: (desk, pos) => {
        const full = townMap.desks.get(desk.id);
        return !!full && isAtDesk(full, pos);
      },
    },
    {
      tableOf: (deskId) => townMap.desks.get(deskId)?.table ?? null,
      timers: () => this.state.tables,
    },
  );
  private chat = new ChatController(
    this,
    () => `town:${this.roomId}`,
    () => this.state.players,
  );
  private readonly onHouseChanged = (ownerId: string) => {
    const shown = [...this.state.lots.values()].some((l) => l.ownerId === ownerId);
    if (shown) void this.refreshLots();
  };

  override onCreate(): void {
    onValidated(this, ClientMsg.Move, moveSchema, (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (player) this.moves.handle(client, player, msg, this.focus.isSeated(client.sessionId));
    });
    this.focus.register();
    this.chat.register();
    registerProfileReload(this, () => this.state.players);
    rejectUnknownMessages(this);
    this.clock.setInterval(() => this.focus.tickTables(Date.now()), 1_000);
    // Server time for synced clocks (radio, table timers); also sent to each joiner.
    this.clock.setInterval(() => this.broadcast(ServerMsg.Clock, clockNow()), 30_000);

    this.clock.setInterval(() => {
      this.state.focusingNow = focusRegistry.count();
    }, 2_000);
    // Houses on the lots: load now, refresh when one changes, and every minute for new owners.
    void this.refreshLots();
    houseEvents.on('changed', this.onHouseChanged);
    this.clock.setInterval(() => void this.refreshLots(), 60_000);
    log.info('town room created', { roomId: this.roomId });
  }

  override onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<AuthedUser> {
    return authenticate(context);
  }

  override onJoin(client: Client, options: unknown): void {
    const auth = authOf(client);
    const parsed = townJoinSchema.safeParse(options ?? {});
    const spawn = this.findSpawn(parsed.success ? parsed.data.fromPlot : undefined);
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
    this.state.players.set(client.sessionId, player);
    this.moves.join(client.sessionId);
    client.send(ServerMsg.Wallet, auth.wallet);
    client.send(ServerMsg.Clock, clockNow());
    this.chat.join(client);
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
    if (player) player.status = this.focus.isSeated(client.sessionId) ? 'focusing' : 'walking';
    this.moves.reset(client.sessionId);
    log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
  }

  override async onLeave(client: Client): Promise<void> {
    this.state.players.delete(client.sessionId);
    this.moves.leave(client.sessionId);
    log.info('player left', { roomId: this.roomId, sessionId: client.sessionId });
    this.chat.leave(client);
    await this.focus.leave(client);
  }

  override onDispose(): void {
    houseEvents.off('changed', this.onHouseChanged);
    log.info('town room disposed', { roomId: this.roomId });
  }

  /** Sync the lots map with the houses on plots 0..N-1. */
  private async refreshLots(): Promise<void> {
    let lots;
    try {
      lots = await db().getLots(townMap.plots.size);
    } catch (err) {
      log.error('could not load town lots', { error: String(err) });
      return;
    }
    const seen = new Set<string>();
    for (const lot of lots) {
      const key = String(lot.plotIndex);
      seen.add(key);
      const state = this.state.lots.get(key) ?? new LotState();
      state.plotIndex = lot.plotIndex;
      state.ownerId = lot.ownerId;
      state.ownerName = lot.ownerName;
      state.level = lot.level;
      state.style = lot.style;
      if (!this.state.lots.has(key)) this.state.lots.set(key, state);
    }
    for (const key of [...this.state.lots.keys()]) if (!seen.has(key)) this.state.lots.delete(key);
  }

  /** The doorstep of the house a player just left, or the map spawn point (nudged). */
  private findSpawn(fromPlot?: number): Vec2 {
    const plot = fromPlot !== undefined ? townMap.plots.get(fromPlot) : undefined;
    if (plot && canStand(townMap.grid, plot.doorstep.x, plot.doorstep.y))
      return { ...plot.doorstep };
    const base = townMap.spawn;
    for (let attempt = 0; attempt < 10; attempt++) {
      const x = base.x + Math.round((Math.random() - 0.5) * 24);
      const y = base.y + Math.round((Math.random() - 0.5) * 12);
      if (canStand(townMap.grid, x, y)) return { x, y };
    }
    return { ...base };
  }
}
