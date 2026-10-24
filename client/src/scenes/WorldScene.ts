import Phaser from 'phaser';
import { Callbacks, CloseCode, type Room } from '@colyseus/sdk';
import {
  ClientMsg,
  DIRECTIONS,
  facingFor,
  MOVE_SEND_INTERVAL_MS,
  moveCorrectSchema,
  ServerMsg,
  stepMovement,
  type CollisionGrid,
  type Direction,
  type FocusEndedMessage,
  type FocusErrorMessage,
  type FocusStateMessage,
  type MoveMessage,
  type ChatMessage,
  type ChatNotice,
  type ClockMessage,
  type PlayerState,
  type TownState,
  type WalletMessage,
  type EmoteMessage,
  type WhisperMessage,
  WHISPER_RANGE_PX,
} from '@focus-town/shared';
import { PlayerSprite } from '../game/PlayerSprite';
import { chat, type Partner } from '../net/chat';
import { syncClock } from '../net/clock';
import { startHeartbeat, stopHeartbeat } from '../net/heartbeat';
import { attachRoomSender } from '../net/roomBridge';
import { sfx } from '../audio/sfx';
import { minimap } from '../game/minimap';
import { revealWorld } from '../game/navigation';
import { setZoom, uiStore } from '../store';

/** Remote players glide slightly longer than the send interval so motion stays continuous. */
const REMOTE_TWEEN_MS = MOVE_SEND_INTERVAL_MS + 30;

export const asDirection = (d: string): Direction =>
  (DIRECTIONS as readonly string[]).includes(d) ? (d as Direction) : 'down';

/**
 * Common behaviour of a walkable world backed by a Colyseus room: players and name tags,
 * client-predicted movement, focus messages, input keys, zoom and reconnects.
 * Subclasses build the world, join their room and add their own interactions.
 */
export abstract class WorldScene<S extends object> extends Phaser.Scene {
  protected room: Room<unknown, S> | null = null;
  protected grid!: CollisionGrid;
  protected sprites = new Map<string, PlayerSprite>();
  protected local: PlayerSprite | null = null;
  /** Extra text objects that must follow the zoom level to stay crisp. */
  protected labels: Phaser.GameObjects.Text[] = [];

  private keys!: {
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    wasd: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  };
  protected pos = { x: 0, y: 0 };
  protected dir: Direction = 'down';
  /** Movement keys held this frame: -1/0/1 per axis. */
  protected heldInput = { x: 0, y: 0 };
  private moving = false;
  private lastSent: MoveMessage | null = null;
  private lastSentAt = 0;
  private nearbyCheckedAt = 0;

  /** Draw the world and set `this.grid`. Called before joining. */
  protected abstract buildWorld(): void;
  protected abstract joinRoom(): Promise<Room<unknown, S>>;
  /** Room-specific state listeners and messages. */
  protected abstract bindWorld(room: Room<unknown, S>): void;
  /** E pressed: return true if this scene handled it. */
  protected abstract use(): boolean;
  /** After every local movement step: proximity checks (desks, doors…). */
  protected abstract afterMove(): void;
  /** Called when joining failed for good (e.g. refused); default does nothing. */
  protected onJoinFailed(_err: unknown): void {}

  /** Should the local player stand still this frame? */
  protected movementLocked(): boolean {
    const ui = uiStore.get();
    return Boolean(
      ui.focus || ui.shopOpen || ui.houseSettingsOpen || ui.friendsOpen || ui.statsOpen,
    );
  }

  create(): void {
    this.sprites = new Map();
    this.labels = [];
    this.local = null;
    this.room = null;
    this.buildWorld();
    this.cameras.main.setBackgroundColor('#1d1b2a');
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyZoom, this);

    const keyboard = this.input.keyboard!;
    this.keys = {
      cursors: keyboard.createCursorKeys(),
      wasd: keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>,
    };
    keyboard.addKey('E').on('down', () => {
      if (this.use()) return;
      const ui = uiStore.get();
      if (ui.nearDesk && !ui.focus) uiStore.set({ timerOpen: true, focusSummary: null });
    });
    keyboard.addKey('I').on('down', () => {
      uiStore.set({ inventoryOpen: !uiStore.get().inventoryOpen });
    });
    keyboard.addKey('M').on('down', () => {
      uiStore.set({ mapOpen: !uiStore.get().mapOpen });
    });
    keyboard.addKey('ESC').on('down', () => this.escape());
    this.zoomTarget = this.targetZoom();
    const unsubscribe = uiStore.subscribe(this.onStoreChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        if (dy !== 0) setZoom(uiStore.get().zoom + (dy < 0 ? 1 : -1));
      },
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    window.addEventListener('pagehide', this.leaveOnPageHide);
    window.addEventListener('pageshow', this.rejoinOnPageShow);
    void this.connect();
  }

  /** Esc closes the topmost panel. */
  protected escape(): void {
    const ui = uiStore.get();
    if (
      ui.shopOpen ||
      ui.inventoryOpen ||
      ui.houseSettingsOpen ||
      ui.friendsOpen ||
      ui.statsOpen ||
      ui.mapOpen
    ) {
      uiStore.set({
        shopOpen: false,
        inventoryOpen: false,
        houseSettingsOpen: false,
        friendsOpen: false,
        statsOpen: false,
        mapOpen: false,
      });
    } else if (!ui.focus) uiStore.set({ timerOpen: false, focusError: null });
  }

  /** Integer zoom so pixel art stays crisp; aims for roughly 24×16 tiles on screen. */
  protected zoomFor(width: number, height: number): number {
    return Math.max(2, Math.floor(Math.min(width / 384, height / 256)));
  }

  /** Automatic zoom plus your own adjustment (zoom buttons / mouse wheel), 1–6. */
  protected targetZoom(): number {
    const { width, height } = this.scale.gameSize;
    return Math.max(1, Math.min(6, this.zoomFor(width, height) + uiStore.get().zoom));
  }

  protected applyZoom(): void {
    this.cameras.main.setZoom(this.targetZoom());
    this.refreshTextResolution();
  }

  private refreshTextResolution(): void {
    for (const s of this.sprites.values()) s.setTextResolution(this.textResolution());
    for (const t of this.labels) t.setResolution(this.textResolution());
  }

  /** Your zoom setting changed: glide to it. */
  private readonly onStoreChange = (): void => {
    const z = this.targetZoom();
    const cam = this.cameras.main;
    if (z === this.zoomTarget) return;
    this.zoomTarget = z;
    cam.zoomTo(z, 220, 'Sine.easeInOut', true, (_c: unknown, progress: number) => {
      if (progress === 1) this.applyZoom();
    });
  };
  private zoomTarget = 0;

  protected textResolution(): number {
    return this.cameras.main.zoom * (window.devicePixelRatio || 1);
  }

  private async connect(): Promise<void> {
    let room: Room<unknown, S>;
    try {
      room = await this.joinRoom();
    } catch (err) {
      this.onJoinFailed(err);
      revealWorld();
      return;
    }
    if (!this.scene.isActive()) {
      void room.leave();
      return;
    }
    this.room = room;
    this.bindPlayers(room);
    this.bindWorld(room);
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

  private bindPlayers(room: Room<unknown, S>): void {
    // Every world state (TownState, HouseState) has the same `players` and `focusingNow`
    // fields, and that's all this method touches. The SDK can't see that through the generic,
    // so view the room as a TownState room for typing only.
    const callbacks = Callbacks.get(room as unknown as Room<unknown, TownState>);
    attachRoomSender((type, payload) => room.send(type, payload));
    chat.setMe(room.sessionId);

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
      sprite.setStatus(player.status, player.focusMin);
      this.sprites.set(sessionId, sprite);
      this.updateOnlineCount();

      if (isLocal) {
        this.local = sprite;
        this.pos = { x: player.x, y: player.y };
        this.dir = asDirection(player.dir);
        this.onLocalPlayer(sprite);
        revealWorld();
        uiStore.set({ playerName: player.name, playerAvatar: player.avatar });
        callbacks.onChange(player, () => {
          sprite.setLook(player.avatar, player.name);
          uiStore.set({ playerName: player.name, playerAvatar: player.avatar });
          sprite.setStatus(player.status, player.focusMin);
          sprite.setTyping(player.typing);
          // Seated by the server: face the desk.
          if (player.status === 'focusing') {
            this.dir = asDirection(player.dir);
            sprite.setMotion(this.dir, false);
          }
        });
        return;
      }
      // Click a nearby player to whisper to them.
      sprite.onClick(() => {
        if (!this.canClickPlayers()) return;
        const partner = { sessionId, name: player.name };
        if (this.inWhisperRange(sprite)) chat.openWhisper(partner);
        else chat.notice(`Walk closer to ${player.name} to whisper.`);
      });
      callbacks.onChange(player, () => {
        sprite.glideTo(player.x, player.y, REMOTE_TWEEN_MS);
        sprite.setMotion(asDirection(player.dir), player.moving);
        sprite.setLook(player.avatar, player.name);
        sprite.setStatus(player.status, player.focusMin);
        sprite.setTyping(player.typing);
      });
    });

    callbacks.onRemove('players', (_player: PlayerState, sessionId: string) => {
      this.sprites.get(sessionId)?.destroy();
      this.sprites.delete(sessionId);
      if (sessionId === room.sessionId) this.local = null;
      this.updateOnlineCount();
    });

    callbacks.listen('focusingNow', (value: number) => uiStore.set({ focusingNow: value }));

    room.onMessage(ServerMsg.MoveCorrect, (payload: unknown) => {
      const parsed = moveCorrectSchema.safeParse(payload);
      if (!parsed.success) return;
      this.teleport(parsed.data.x, parsed.data.y);
    });
    room.onMessage(ServerMsg.Wallet, (wallet: WalletMessage) => uiStore.set({ wallet }));
    room.onMessage(ServerMsg.Clock, (m: ClockMessage) => syncClock(m.now));
    room.onMessage(ServerMsg.ChatHistory, (history: ChatMessage[]) =>
      chat.reset(history, room.sessionId),
    );
    room.onMessage(ServerMsg.Emote, (m: EmoteMessage) => {
      this.sprites.get(m.sessionId)?.emote(m.emote);
      if (m.sessionId === room.sessionId) sfx.play('pop');
    });
    room.onMessage(ServerMsg.Whisper, (m: WhisperMessage) => {
      if (!chat.isMuted(m.userId)) chat.addWhisper(m);
    });
    room.onMessage(ServerMsg.ChatNotice, (n: ChatNotice) => chat.notice(n.message));
    room.onMessage(ServerMsg.Chat, (m: ChatMessage) => {
      chat.add(m);
      if (!chat.isMuted(m.userId))
        this.sprites.get(m.sessionId)?.say(m.text, this.textResolution());
    });
    room.onMessage(ServerMsg.FocusState, (msg: FocusStateMessage) => {
      if (!uiStore.get().focus) startHeartbeat();
      uiStore.set({
        focus: { ...msg, receivedAt: Date.now() },
        timerOpen: false,
        focusError: null,
        focusSummary: null,
      });
    });
    room.onMessage(ServerMsg.FocusEnded, (msg: FocusEndedMessage) => {
      stopHeartbeat();
      uiStore.set({ focus: null, focusSummary: msg, timerOpen: false });
    });
    room.onMessage(ServerMsg.FocusError, (msg: FocusErrorMessage) => {
      uiStore.set({ focusError: msg.message });
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

  /** Clicking players opens a whisper; off while the house editor uses the pointer. */
  protected canClickPlayers(): boolean {
    return true;
  }

  private inWhisperRange(sprite: PlayerSprite): boolean {
    return Math.hypot(sprite.x - this.pos.x, sprite.y - this.pos.y) <= WHISPER_RANGE_PX;
  }

  /** Who is close enough to whisper to (checked a few times a second). */
  private updateNearby(time: number): void {
    if (time - this.nearbyCheckedAt < 250 || !this.room) return;
    this.nearbyCheckedAt = time;
    const nearby: Partner[] = [];
    for (const [sessionId, sprite] of this.sprites) {
      if (sessionId === this.room.sessionId || !this.inWhisperRange(sprite)) continue;
      nearby.push({ sessionId, name: sprite.playerName });
    }
    nearby.sort((a, b) => a.name.localeCompare(b.name));
    chat.setNearby(nearby);
  }

  /** The local player's sprite exists; default: camera follows it. */
  protected onLocalPlayer(sprite: PlayerSprite): void {
    this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
  }

  /** Snap the local player to a server-given position. */
  protected teleport(x: number, y: number): void {
    this.pos = { x, y };
    this.local?.placeAt(x, y);
    this.lastSent = null;
  }

  private updateOnlineCount(): void {
    uiStore.set({ playersOnline: this.sprites.size });
  }

  /** Every frame, joined or not (ambient life, animations). */
  protected onFrame(_time: number, _delta: number): void {}

  override update(time: number, delta: number): void {
    this.onFrame(time, delta);
    if (!this.local || !this.room) return;
    this.updateNearby(time);
    this.publishMinimap(time);
    if (this.movementLocked()) {
      this.local.setMotion(this.dir, false);
      return;
    }

    const { cursors, wasd } = this.keys;
    const input = {
      x:
        (cursors.right.isDown || wasd.D.isDown ? 1 : 0) -
        (cursors.left.isDown || wasd.A.isDown ? 1 : 0),
      y:
        (cursors.down.isDown || wasd.S.isDown ? 1 : 0) -
        (cursors.up.isDown || wasd.W.isDown ? 1 : 0),
    };
    this.heldInput = input;
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
    this.afterMove();
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

  /** Subclass cleanup hook (runs before the room is left). */
  protected onTeardown(): void {}

  /** World size in px for the minimap, or null for no minimap here. */
  protected minimapSize(): { width: number; height: number } | null {
    return null;
  }

  private minimapAt = 0;
  private publishMinimap(time: number): void {
    const size = this.minimapSize();
    if (!size || time - this.minimapAt < 250) return;
    this.minimapAt = time;
    const others: { x: number; y: number; focusing: boolean }[] = [];
    for (const s of this.sprites.values()) {
      if (s !== this.local) others.push({ x: s.x, y: s.y, focusing: s.isFocusing });
    }
    minimap.set({ ...size, me: { ...this.pos }, others });
  }

  private teardown(): void {
    this.onTeardown();
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyZoom, this);
    window.removeEventListener('pagehide', this.leaveOnPageHide);
    window.removeEventListener('pageshow', this.rejoinOnPageShow);
    attachRoomSender(null);
    stopHeartbeat();
    const focus = uiStore.get().focus;
    if (focus) {
      // Leaving the room ends the session; coins awarded so far are already saved.
      uiStore.set({
        focus: null,
        focusSummary: {
          reason: 'left',
          verifiedMin: focus.verifiedMin,
          coinsEarned: focus.coinsEarned,
          bonus: 0,
        },
      });
    }
    uiStore.set({ nearDesk: null, timerOpen: false });
    chat.reset();
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
