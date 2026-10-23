import Phaser from 'phaser';
import { Callbacks, CloseCode } from '@colyseus/sdk';
import {
  ClientMsg,
  collisionGridFromTiled,
  DIRECTIONS,
  facingFor,
  findObjects,
  getProperty,
  MapObjectType,
  MOVE_SEND_INTERVAL_MS,
  moveCorrectSchema,
  ServerMsg,
  stepMovement,
  type CollisionGrid,
  type Direction,
  type MoveMessage,
  type PlayerState,
  type TiledMap,
  type TiledObject,
} from '@focus-town/shared';
import { PlayerSprite } from '../game/PlayerSprite';
import { joinTown, type TownRoom } from '../net/colyseus';
import { guestIdentity } from '../net/guest';
import { uiStore } from '../store';
import { TOWN_MAP_KEY } from './BootScene';

/** Remote players glide slightly longer than the send interval so motion stays continuous. */
const REMOTE_TWEEN_MS = MOVE_SEND_INTERVAL_MS + 30;

const asDirection = (d: string): Direction =>
  (DIRECTIONS as readonly string[]).includes(d) ? (d as Direction) : 'down';

export class TownScene extends Phaser.Scene {
  private room: TownRoom | null = null;
  private grid!: CollisionGrid;
  private desks: TiledObject[] = [];
  private sprites = new Map<string, PlayerSprite>();
  private local: PlayerSprite | null = null;

  private keys!: {
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    wasd: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  };
  private pos = { x: 0, y: 0 };
  private dir: Direction = 'down';
  private moving = false;
  private lastSent: MoveMessage | null = null;
  private lastSentAt = 0;

  constructor() {
    super('Town');
  }

  create(): void {
    const map = this.make.tilemap({ key: TOWN_MAP_KEY });
    const tilesets = [map.addTilesetImage('tinytown'), map.addTilesetImage('indoor')].filter(
      (t): t is Phaser.Tilemaps.Tileset => t !== null,
    );
    for (const name of ['ground', 'decor', 'buildings'])
      map.createLayer(name, tilesets)?.setDepth(-10);

    const mapData = this.cache.tilemap.get(TOWN_MAP_KEY) as { data: TiledMap };
    this.grid = collisionGridFromTiled(mapData.data);
    this.desks = findObjects(mapData.data, MapObjectType.Desk);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBackgroundColor('#1d1b2a');
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyZoom, this);

    const keyboard = this.input.keyboard!;
    this.keys = {
      cursors: keyboard.createCursorKeys(),
      wasd: keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>,
    };

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    window.addEventListener('pagehide', this.leaveOnPageHide);
    window.addEventListener('pageshow', this.rejoinOnPageShow);
    void this.connect();
  }

  /** Integer zoom so pixel art stays crisp; aims for roughly 24×16 tiles on screen. */
  private applyZoom(): void {
    const { width, height } = this.scale.gameSize;
    const zoom = Math.max(2, Math.floor(Math.min(width / 384, height / 256)));
    this.cameras.main.setZoom(zoom);
    for (const s of this.sprites.values()) s.setTextResolution(this.textResolution());
  }

  private textResolution(): number {
    return this.cameras.main.zoom * (window.devicePixelRatio || 1);
  }

  private async connect(): Promise<void> {
    const identity = guestIdentity();
    uiStore.set({ playerName: identity.name });
    let room: TownRoom;
    try {
      room = await joinTown(identity);
    } catch {
      return; // joinTown already reported the error to the UI
    }
    if (!this.scene.isActive()) {
      void room.leave();
      return;
    }
    this.room = room;
    this.bindRoom(room);
  }

  /**
   * Closing or reloading the tab would otherwise look like a network drop, and the server
   * would hold the seat for the reconnection grace period, leaving a ghost behind.
   */
  private readonly leaveOnPageHide = (): void => {
    if (this.room) void this.room.leave(true);
  };

  /** A page restored from the back/forward cache left its room on pagehide; join again. */
  private readonly rejoinOnPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted && !this.room) this.scene.restart();
  };

  private bindRoom(room: TownRoom): void {
    const callbacks = Callbacks.get(room);

    callbacks.onAdd('players', (player: PlayerState, sessionId: string) => {
      const isLocal = sessionId === room.sessionId;
      const sprite = new PlayerSprite(
        this,
        player.x,
        player.y,
        player.avatar,
        player.name,
        isLocal,
        this.textResolution(),
      );
      sprite.setMotion(asDirection(player.dir), false);
      this.sprites.set(sessionId, sprite);
      this.updateOnlineCount();

      if (isLocal) {
        this.local = sprite;
        this.pos = { x: player.x, y: player.y };
        this.dir = asDirection(player.dir);
        this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
        return;
      }
      sprite.setAway(player.status === 'away');
      callbacks.onChange(player, () => {
        sprite.glideTo(player.x, player.y, REMOTE_TWEEN_MS);
        sprite.setMotion(asDirection(player.dir), player.moving);
        sprite.setAway(player.status === 'away');
      });
    });

    callbacks.onRemove('players', (_player: PlayerState, sessionId: string) => {
      this.sprites.get(sessionId)?.destroy();
      this.sprites.delete(sessionId);
      if (sessionId === room.sessionId) this.local = null;
      this.updateOnlineCount();
    });

    room.onMessage(ServerMsg.MoveCorrect, (payload: unknown) => {
      const parsed = moveCorrectSchema.safeParse(payload);
      if (!parsed.success) return;
      this.pos = { x: parsed.data.x, y: parsed.data.y };
      this.local?.placeAt(this.pos.x, this.pos.y);
      this.lastSent = null;
    });

    room.onDrop(() => uiStore.set({ connection: { kind: 'reconnecting' } }));
    room.onReconnect(() => uiStore.set({ connection: { kind: 'connected' } }));
    room.onLeave((code) => {
      this.room = null;
      // Anything but a deliberate leave (e.g. the server restarted and the reconnection
      // window is gone): rebuild the scene, which joins a fresh room.
      if (code !== CloseCode.CONSENTED && this.scene.isActive()) {
        uiStore.set({ connection: { kind: 'reconnecting' } });
        this.scene.restart();
      }
    });
  }

  private updateOnlineCount(): void {
    uiStore.set({ playersOnline: this.sprites.size });
  }

  override update(time: number, delta: number): void {
    if (!this.local || !this.room) return;

    const { cursors, wasd } = this.keys;
    const input = {
      x:
        (cursors.right.isDown || wasd.D.isDown ? 1 : 0) -
        (cursors.left.isDown || wasd.A.isDown ? 1 : 0),
      y:
        (cursors.down.isDown || wasd.S.isDown ? 1 : 0) -
        (cursors.up.isDown || wasd.W.isDown ? 1 : 0),
    };
    const wantsToMove = input.x !== 0 || input.y !== 0;
    // Cap the step so a long frame (tab refocus) can't fling the player across the map.
    const next = stepMovement(this.grid, this.pos, input, Math.min(delta, 50));
    const moved = next.x !== this.pos.x || next.y !== this.pos.y;
    this.pos = next;
    this.dir = facingFor(input, this.dir);
    this.moving = wantsToMove && moved;

    this.local.placeAt(this.pos.x, this.pos.y);
    this.local.setMotion(this.dir, wantsToMove);
    this.sendMove(time);
    this.updateNearDesk();
  }

  /** Send the predicted position at most every MOVE_SEND_INTERVAL_MS, and only when it changed. */
  private sendMove(time: number): void {
    const msg: MoveMessage = {
      x: Math.round(this.pos.x * 100) / 100,
      y: Math.round(this.pos.y * 100) / 100,
      dir: this.dir,
      moving: this.moving,
    };
    const last = this.lastSent;
    const changed =
      !last ||
      last.x !== msg.x ||
      last.y !== msg.y ||
      last.dir !== msg.dir ||
      last.moving !== msg.moving;
    if (!changed || time - this.lastSentAt < MOVE_SEND_INTERVAL_MS) return;
    this.room?.send(ClientMsg.Move, msg);
    this.lastSent = msg;
    this.lastSentAt = time;
  }

  private updateNearDesk(): void {
    const desk = this.desks.find(
      (d) =>
        this.pos.x >= d.x &&
        this.pos.x < d.x + d.width &&
        this.pos.y > d.y &&
        this.pos.y <= d.y + d.height,
    );
    const id = desk ? (getProperty<string>(desk, 'table') ?? desk.name) : null;
    if (uiStore.get().nearDesk !== id) uiStore.set({ nearDesk: id });
  }

  private teardown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyZoom, this);
    window.removeEventListener('pagehide', this.leaveOnPageHide);
    window.removeEventListener('pageshow', this.rejoinOnPageShow);
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.local = null;
    this.lastSent = null;
    if (this.room) {
      void this.room.leave();
      this.room = null;
    }
  }
}
