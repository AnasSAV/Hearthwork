import Phaser from 'phaser';
import { Callbacks, type Room } from '@colyseus/sdk';
import {
  BUTTERFLY_KINDS,
  ClientMsg,
  collisionGridFromTiled,
  findObjectLayer,
  findObjects,
  FISH,
  GAMES,
  getProperty,
  objectType,
  MapLayer,
  MapObjectType,
  RAFT_SPEED,
  raftInput,
  ServerMsg,
  TREASURES,
  type CollisionGrid,
  type CritterState,
  type GameEvent,
  type GameId,
  type GameState,
  type GameStatusMessage,
  type PlayerState,
  type TiledMap,
  type TiledObject,
  type Vec2,
} from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { ABOVE_DEPTH, GROUND_DEPTH } from '../game/depths';
import { WorldLife } from '../game/life';
import type { GameSceneData } from '../game/navigation';
import type { PlayerSprite } from '../game/PlayerSprite';
import { joinGame } from '../net/colyseus';
import { emptyGameUi, uiStore, type GameUi } from '../store';
import { asDirection, WorldScene } from './WorldScene';

const SPRITES_KEY = 'games';
const TILESET_KEY = 'games';

const FISH_NAME = new Map(FISH.map((f) => [f.id as string, f.name]));
const TREASURE_NAME = new Map(TREASURES.map((t) => [t.id as string, t.name]));
const BUTTERFLY_COLOR = new Map(BUTTERFLY_KINDS.map((k) => [k.id as string, k.color]));
const BUTTERFLY_NAME = new Map(BUTTERFLY_KINDS.map((k) => [k.id as string, k.name]));

const HEAT_TEXT: Record<string, string> = {
  freezing: 'Freezing...',
  cold: 'Cold.',
  warm: 'Warm!',
  hot: 'Hot!',
  burning: 'Burning hot!',
};
const HEAT_COLOR: Record<string, number> = {
  freezing: 0x6aa8e2,
  cold: 0x9fc6e8,
  warm: 0xffd166,
  hot: 0xffa24c,
  burning: 0xea5a44,
};

const insideRect = (o: TiledObject, p: Vec2) =>
  p.x >= o.x && p.x <= o.x + o.width && p.y >= o.y && p.y <= o.y + o.height;

/**
 * A mini-game's map. Walking, chat and players work as they do in town (WorldScene); this adds
 * the action button, the game's visuals and what the server says is happening. The server makes
 * every decision; this only shows them.
 */
export class GameScene extends WorldScene<GameState> {
  private game_: GameId = 'fishing';
  private mapObjects: TiledObject[] = [];
  private raftGrid: CollisionGrid | null = null;
  private life: WorldLife | null = null;
  private lines = new Map<string, Phaser.GameObjects.Graphics>();
  private rafts = new Map<string, Phaser.GameObjects.Image>();
  private butterflies = new Map<string, Phaser.GameObjects.Sprite>();
  private buoys = new Map<string, Phaser.GameObjects.Sprite>();
  private streaks: Phaser.GameObjects.Rectangle[] = [];
  /** The local player's own mode, as the server last told us. */
  private mode = '';
  /** Fishing: between casting and the fish being landed or lost. */
  private fishing: 'idle' | 'waiting' | 'bite' | 'reel' = 'idle';
  private usedAt = 0;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.game_ = data.game;
    this.mode = '';
    this.fishing = 'idle';
  }

  preload(): void {
    this.load.setPath('assets');
    const { map } = GAMES[this.game_];
    // Each map has its own tileset; the Town Builder rewrites it under the same name, so ask for
    // the version the map names (a cached older tileset would scramble the map).
    type Versioned = { properties?: { name: string; value: unknown }[] };
    const loadArt = (data: Versioned) => {
      const version = data.properties?.find((p) => p.name === 'version')?.value;
      const v = typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
      if (!this.textures.exists(`${map}-tiles`)) {
        this.load.image(`${map}-tiles`, `tilesets/${map}.png${v}`);
      }
      if (!this.textures.exists(SPRITES_KEY)) {
        this.load.atlas(SPRITES_KEY, `sprites/games.png${v}`, `sprites/games.json${v}`);
      }
    };
    const cached = this.cache.tilemap.get(map) as { data: Versioned } | undefined;
    if (cached) {
      loadArt(cached.data);
      return;
    }
    this.load.once(
      `filecomplete-tilemapJSON-${map}`,
      (_key: string, _type: string, data: Versioned) => loadArt(data),
    );
    this.load.tilemapTiledJSON(map, `maps/${map}.json`);
  }

  protected buildWorld(): void {
    const info = GAMES[this.game_];
    uiStore.set({ house: null, game: emptyGameUi(this.game_) });

    const map = this.make.tilemap({ key: info.map });
    const tileset = map.addTilesetImage(TILESET_KEY, `${info.map}-tiles`);
    if (!tileset) throw new Error('games tileset missing');
    for (const name of ['ground', 'paths', 'decor', 'below', 'below2'])
      map.createLayer(name, tileset)?.setDepth(GROUND_DEPTH);
    for (const name of ['above', 'above2']) map.createLayer(name, tileset)?.setDepth(ABOVE_DEPTH);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const data = (this.cache.tilemap.get(info.map) as { data: TiledMap }).data;
    this.grid = collisionGridFromTiled(data);
    this.raftGrid = data.layers.some((l) => l.name === 'raft')
      ? collisionGridFromTiled(data, 'raft')
      : null;
    this.mapObjects = findObjectLayer(data, MapLayer.Objects)?.objects ?? [];

    for (const o of findObjects(data, MapObjectType.Label)) {
      this.labels.push(
        this.add
          .text(o.x, o.y, o.name, {
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: '9px',
            fontStyle: 'bold',
            color: '#fff3b0',
            stroke: '#1d1b2a',
            strokeThickness: 2,
            resolution: this.textResolution(),
          })
          .setOrigin(0.5, 1)
          .setDepth(ABOVE_DEPTH + 1),
      );
    }

    for (const o of findObjects(data, MapObjectType.Anim)) {
      const frames = getProperty<number>(o, 'frames') ?? 1;
      const key = `game-anim:${o.name}`;
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: Array.from({ length: frames }, (_, i) => ({
            key: SPRITES_KEY,
            frame: `${o.name}:${i}`,
          })),
          frameRate: getProperty<number>(o, 'fps') ?? 8,
          repeat: -1,
        });
      }
      const bottom = o.y + o.height;
      this.add
        .sprite(o.x, bottom, SPRITES_KEY, `${o.name}:0`)
        .setOrigin(0, 1)
        .setDepth(bottom)
        .play({ key, startFrame: Math.floor(Math.random() * frames) });
    }

    // Buoys to collect on the river.
    for (const o of findObjects(data, MapObjectType.Buoy)) {
      const sprite = this.add
        .sprite(o.x, o.y, SPRITES_KEY, 'buoy:0')
        .setOrigin(0.5, 0.75)
        .setDepth(o.y)
        .play('game-anim:buoy');
      this.buoys.set(o.name, sprite);
    }

    this.life = new WorldLife(this, {
      bounds: { x: 0, y: 0, width: map.widthInPixels, height: map.heightInPixels },
      flowers: [],
      butterflies: 0,
    });
    this.updatePrompt();
  }

  protected joinRoom(): Promise<Room<unknown, GameState>> {
    return joinGame(this.game_);
  }

  protected bindWorld(room: Room<unknown, GameState>): void {
    room.onMessage(ServerMsg.GameEvent, (e: GameEvent) => this.onGameEvent(e));
    room.onMessage(ServerMsg.GameStatus, (s: GameStatusMessage) => {
      this.patchGame({
        score: s.score,
        note: s.note,
        playedMin: s.playedMin,
        coinsEarned: s.coinsEarned,
        capReached: s.capReached,
      });
    });
    if (this.game_ === 'butterflies') this.bindButterflies(room);
  }

  // -------------------------------------------------------------------------------------------
  // The action button
  // -------------------------------------------------------------------------------------------

  /** E, or a tap on the prompt. Handled here, so the server decides what it means. */
  protected use(): boolean {
    const now = Date.now();
    if (now - this.usedAt < 120) return true;
    this.usedAt = now;
    if (!uiStore.get().game?.prompt) return true;
    if (this.game_ === 'butterflies') this.swingNet();
    this.room?.send(ClientMsg.GameUse);
    return true;
  }

  /** While fishing you stand still. */
  protected override movementLocked(): boolean {
    return super.movementLocked() || this.fishing !== 'idle';
  }

  /** A raft is steered, not walked. */
  protected override walkingAnim(): boolean {
    return this.mode !== 'raft';
  }

  protected override steer(input: Vec2): Vec2 {
    return this.mode === 'raft' ? raftInput(input) : input;
  }

  protected override moveGrid(): CollisionGrid {
    return this.mode === 'raft' && this.raftGrid ? this.raftGrid : this.grid;
  }

  protected override moveSpeed(): number {
    return this.mode === 'raft' ? RAFT_SPEED : super.moveSpeed();
  }

  protected afterMove(): void {
    this.updatePrompt();
  }

  private updatePrompt(): void {
    let prompt: string | null = null;
    switch (this.game_) {
      case 'fishing':
        if (this.fishing === 'waiting') prompt = 'Reel back in';
        else if (this.fishing === 'bite') prompt = 'Hook it!';
        else if (this.fishing === 'reel') prompt = 'Stop!';
        else if (this.atAny('fish_zone')) prompt = 'Cast your line';
        break;
      case 'rafting':
        if (this.mode !== 'raft' && this.atAny('launch')) prompt = 'Launch the raft';
        break;
      case 'butterflies':
        prompt = 'Swing your net';
        break;
      case 'treasure':
        prompt = this.atAny('dig_zone') ? 'Dig here' : null;
        break;
    }
    if (uiStore.get().game?.prompt !== prompt) this.patchGame({ prompt });
  }

  private atAny(type: string): boolean {
    return this.mapObjects.some((o) => objectType(o) === type && insideRect(o, this.pos));
  }

  // -------------------------------------------------------------------------------------------
  // What the server says happened
  // -------------------------------------------------------------------------------------------

  private onGameEvent(e: GameEvent): void {
    switch (e.kind) {
      case 'cast':
        this.fishing = 'waiting';
        this.patchGame({ reel: null });
        this.setMessage('Waiting for a bite...');
        sfx.play('open');
        break;
      case 'cast-cancelled':
        this.fishing = 'idle';
        this.setMessage('You reeled back in.');
        break;
      case 'bite':
        this.fishing = 'bite';
        this.setMessage('A bite! Hook it!');
        sfx.play('pop');
        break;
      case 'reel':
        this.fishing = 'reel';
        this.patchGame({
          reel: {
            startedAt: Date.now(),
            periodMs: e.periodMs,
            zoneStart: e.zoneStart,
            zone: e.zone,
            limitMs: e.limitMs,
          },
        });
        this.setMessage('Stop the marker in the green zone!');
        break;
      case 'caught':
        this.fishing = 'idle';
        this.patchGame({ reel: null });
        this.setMessage(`You landed a ${FISH_NAME.get(e.fish) ?? 'fish'}! +${e.points}`);
        this.showOverHead(this.fishTexture(e.fish));
        sfx.play('coin');
        break;
      case 'escaped':
        this.fishing = 'idle';
        this.patchGame({ reel: null });
        this.setMessage(e.why === 'missed' ? 'It slipped off the hook.' : 'Too slow, it got away.');
        sfx.play('error');
        break;
      case 'raft-start':
        this.patchGame({ raftStartedAt: Date.now() });
        this.setMessage('Go! Dodge the rocks and grab the buoys.');
        for (const b of this.buoys.values()) b.setVisible(true);
        sfx.play('whoosh');
        break;
      case 'raft-buoy':
        this.buoys.get(e.id)?.setVisible(false);
        this.setMessage('Buoy! 2 seconds off.');
        sfx.play('coin');
        break;
      case 'raft-finish':
        this.patchGame({ raftStartedAt: null });
        this.setMessage(
          `Finished in ${e.seconds} s with ${e.buoys} ${e.buoys === 1 ? 'buoy' : 'buoys'}${e.best ? '. Your best!' : '.'}`,
        );
        sfx.play('chime');
        break;
      case 'raft-bail':
        this.patchGame({ raftStartedAt: null });
        this.setMessage('Back on the bank.');
        break;
      case 'net':
        if (e.caught.length === 0) break;
        this.setMessage(
          e.caught
            .map((c) => `${BUTTERFLY_NAME.get(c.kind) ?? 'Butterfly'} +${c.points}`)
            .join(', '),
        );
        sfx.play('coin');
        break;
      case 'dug':
        this.digHole(e.x, e.y, HEAT_COLOR[e.heat] ?? 0xffffff);
        this.setMessage(
          e.bearing
            ? `${HEAT_TEXT[e.heat]} The compass points ${e.bearing}.`
            : (HEAT_TEXT[e.heat] ?? ''),
        );
        sfx.play('pop');
        break;
      case 'found':
        this.digHole(e.x, e.y, 0xffd24a);
        this.setMessage(
          `${TREASURE_NAME.get(e.treasure) ?? 'Treasure'}, in ${e.digs} ${e.digs === 1 ? 'dig' : 'digs'}! +${e.points}`,
        );
        this.showOverHead('shell-gold');
        sfx.play('chime');
        break;
      case 'refused':
        this.setMessage(e.message);
        sfx.play('error');
        break;
    }
    this.updatePrompt();
  }

  private patchGame(patch: Partial<GameUi>): void {
    const game = uiStore.get().game;
    if (game) uiStore.set({ game: { ...game, ...patch } });
  }

  private setMessage(message: string): void {
    this.patchGame({ message });
  }

  // -------------------------------------------------------------------------------------------
  // Pictures
  // -------------------------------------------------------------------------------------------

  protected override onPlayerState(
    sessionId: string,
    player: PlayerState,
    sprite: PlayerSprite,
  ): void {
    const isMe = sessionId === this.room?.sessionId;
    // Casting, the server turns you to face the water your line went into.
    if (isMe && player.mode === 'cast' && player.dir !== this.dir) {
      this.dir = asDirection(player.dir);
      sprite.setMotion(this.dir, false);
    }
    if (isMe && player.mode !== this.mode) {
      this.mode = player.mode;
      this.updatePrompt();
    }
    this.drawRaft(sessionId, player.mode === 'raft', sprite);
    if (player.mode === 'raft') sprite.setMotion('down', false);
    this.drawLine(sessionId, player.mode === 'cast', player, sprite);
  }

  private drawRaft(sessionId: string, on: boolean, sprite: PlayerSprite): void {
    let raft = this.rafts.get(sessionId);
    if (on && !raft) {
      raft = this.add.image(0, 0, SPRITES_KEY, 'raft').setOrigin(0.5, 0.5).setScale(0.75);
      this.rafts.set(sessionId, raft);
    } else if (!on && raft) {
      raft.destroy();
      this.rafts.delete(sessionId);
      raft = undefined;
    }
    raft?.setPosition(sprite.x, sprite.y - 6).setDepth(sprite.y - 1);
  }

  private drawLine(
    sessionId: string,
    on: boolean,
    player: PlayerState,
    sprite: PlayerSprite,
  ): void {
    let line = this.lines.get(sessionId);
    if (!on) {
      line?.destroy();
      this.lines.delete(sessionId);
      return;
    }
    if (!line) {
      line = this.add.graphics();
      this.lines.set(sessionId, line);
    }
    line
      .setData('x', sprite.x)
      .setData('y', sprite.y)
      .setData('dir', player.dir)
      .setData('tx', player.castX)
      .setData('ty', player.castY);
  }

  protected override onFrame(time: number, delta: number): void {
    this.life?.update(time, delta);
    // Keep rafts under their players, and bob the fishing floats.
    for (const [id, raft] of this.rafts) {
      const sprite = this.sprites.get(id);
      if (sprite) raft.setPosition(sprite.x, sprite.y - 6).setDepth(sprite.y - 1);
    }
    for (const line of this.lines.values()) {
      const x = line.getData('x') as number;
      const y = line.getData('y') as number;
      const dir = line.getData('dir') as string;
      // The float is where the server says the line landed (in open water).
      const tx = line.getData('tx') as number;
      const ty = line.getData('ty') as number;
      const dx = tx || ty ? tx - x : dir === 'left' ? -26 : dir === 'right' ? 26 : 0;
      const dy = tx || ty ? ty - y : dir === 'up' ? -34 : dir === 'down' ? 22 : -4;
      const bob = Math.sin(time / 300) * 1.2;
      const startX = x + (dir === 'right' ? 6 : dir === 'left' ? -6 : 5);
      const startY = y - 14;
      line.clear();
      line.lineStyle(1, 0xf7ead2, 0.85);
      line.beginPath();
      line.moveTo(startX, startY);
      line.lineTo(x + dx, y + dy + bob);
      line.strokePath();
      line.fillStyle(0xea5a44, 1);
      line.fillRect(x + dx - 1.5, y + dy + bob - 1.5, 3, 3);
      line.fillStyle(0xffffff, 1);
      line.fillRect(x + dx - 1.5, y + dy + bob + 0.5, 3, 1);
      line.setDepth(y + 1);
    }
    if (this.mode === 'raft') this.driftStreaks(delta);
    else this.clearStreaks();
    // Butterflies glide to where the server says they are.
    for (const b of this.butterflies.values()) {
      const tx = b.getData('tx') as number;
      const ty = b.getData('ty') as number;
      const k = Math.min(1, delta / 120);
      b.x += (tx - b.x) * k;
      b.y += (ty - b.y) * k;
      b.setDepth(b.y + 12);
    }
  }

  /** White flecks rushing past on the water, so the current looks like it's moving. */
  private driftStreaks(delta: number): void {
    const cam = this.cameras.main;
    const view = cam.worldView;
    while (this.streaks.length < 22) {
      const streak = this.add
        .rectangle(
          view.x + Math.random() * view.width,
          view.y + Math.random() * view.height,
          1,
          4 + Math.random() * 6,
          0xffffff,
          0.35,
        )
        .setDepth(GROUND_DEPTH + 1);
      this.streaks.push(streak);
    }
    for (const s of this.streaks) {
      s.y -= ((delta / 1000) * RAFT_SPEED) / 3;
      if (s.y < view.y - 10 || s.y > view.bottom + 10 || s.x < view.x - 4 || s.x > view.right + 4) {
        s.setPosition(view.x + Math.random() * view.width, view.bottom + Math.random() * 20);
      }
      const onWater =
        this.raftGrid &&
        this.raftGrid.solid[Math.floor(s.y / 16) * this.raftGrid.width + Math.floor(s.x / 16)] ===
          0;
      s.setVisible(!!onWater);
    }
  }

  private clearStreaks(): void {
    if (!this.streaks.length) return;
    for (const s of this.streaks) s.destroy();
    this.streaks = [];
  }

  private fishTexture(fish: string): string {
    const key = `fish-${fish}`;
    if (!this.textures.exists(key)) {
      const color = FISH.find((f) => f.id === fish)?.color ?? '#a8c6d8';
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1);
      g.fillRect(2, 1, 7, 4);
      g.fillRect(1, 2, 1, 2);
      g.fillRect(9, 2, 1, 2);
      g.fillRect(10, 1, 1, 4);
      g.fillStyle(0x2b1d12, 1);
      g.fillRect(3, 2, 1, 1);
      g.generateTexture(key, 12, 6);
      g.destroy();
    }
    return key;
  }

  /** A little picture of what you found, rising over your head. */
  private showOverHead(texture: string): void {
    const local = this.local;
    if (!local) return;
    const fromAtlas = this.textures.get(SPRITES_KEY).has(texture);
    const icon = fromAtlas
      ? this.add.image(local.x, local.y - 30, SPRITES_KEY, texture)
      : this.add.image(local.x, local.y - 30, texture);
    icon.setDepth(ABOVE_DEPTH + 2);
    this.tweens.add({
      targets: icon,
      y: icon.y - 16,
      alpha: 0,
      delay: 900,
      duration: 700,
      onComplete: () => icon.destroy(),
    });
  }

  private digHole(x: number, y: number, heat: number): void {
    const hole = this.add.ellipse(x, y - 2, 12, 7, 0x9a6a34).setDepth(GROUND_DEPTH + 1);
    const glow = this.add.ellipse(x, y - 2, 6, 3, heat).setDepth(GROUND_DEPTH + 2);
    this.tweens.add({
      targets: [hole, glow],
      alpha: 0,
      delay: 20_000,
      duration: 2_000,
      onComplete: () => {
        hole.destroy();
        glow.destroy();
      },
    });
  }

  private swingNet(): void {
    const local = this.local;
    if (!local) return;
    const dir = this.dir;
    const ax = dir === 'left' ? -12 : dir === 'right' ? 12 : 0;
    const ay = dir === 'up' ? -18 : dir === 'down' ? 6 : -8;
    const net = this.add
      .ellipse(local.x + ax, local.y + ay, 16, 16)
      .setStrokeStyle(1.5, 0xfff3b0, 0.95)
      .setDepth(ABOVE_DEPTH + 1);
    this.tweens.add({
      targets: net,
      scale: 1.5,
      alpha: 0,
      duration: 240,
      onComplete: () => net.destroy(),
    });
  }

  private bindButterflies(room: Room<unknown, GameState>): void {
    const callbacks = Callbacks.get(room);
    callbacks.onAdd('critters', (c: CritterState, id: string) => {
      const sprite = this.add
        .sprite(c.x, c.y, 'life-butterfly', 0)
        .setTint(BUTTERFLY_COLOR.get(c.kind) ?? 0xffffff)
        .setScale(1.4)
        .setData('tx', c.x)
        .setData('ty', c.y);
      sprite.play('life-butterfly-flap');
      this.butterflies.set(id, sprite);
      callbacks.onChange(c, () => sprite.setData('tx', c.x).setData('ty', c.y));
    });
    callbacks.onRemove('critters', (_c: CritterState, id: string) => {
      this.butterflies.get(id)?.destroy();
      this.butterflies.delete(id);
    });
  }

  protected override onTeardown(): void {
    this.life?.destroy();
    this.life = null;
    for (const r of this.rafts.values()) r.destroy();
    this.rafts.clear();
    for (const l of this.lines.values()) l.destroy();
    this.lines.clear();
    for (const b of this.butterflies.values()) b.destroy();
    this.butterflies.clear();
    this.buoys.clear();
    this.streaks = [];
    uiStore.set({ game: null });
  }
}
