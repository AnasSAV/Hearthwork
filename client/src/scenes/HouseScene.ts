import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import {
  atExit,
  atFrontDoor,
  atGate,
  CATALOG_BY_ID,
  ClientMsg,
  houseCollisionGrid,
  houseExteriorWidth,
  houseWorld,
  roomDims,
  ServerMsg,
  spriteKey,
  studySeats,
  TILE_SIZE,
  type HouseDims,
  type HouseNoticeMessage,
  type HouseState,
  type Rect,
  type StudySeat,
  YARD_ROOM,
} from '@focus-town/shared';
import { itemFrame } from '../game/frames';
import { InteriorView } from '../game/interior';
import { goToTown, type HouseSceneData } from '../game/navigation';
import { YardView } from '../game/yard';
import type { PlayerSprite } from '../game/PlayerSprite';
import { editor, type EditItem } from '../house/editor';
import { joinHouse } from '../net/colyseus';
import { supabase } from '../net/supabase';
import { showNotice, uiStore, type NearDesk } from '../store';
import { WorldScene } from './WorldScene';

/**
 * A home: the yard (garden, house exterior, gate to town) and the interior, side by side in one
 * world. The front door moves you between them (the server checks you're standing at it); the
 * camera frames whichever part you're in.
 */
export class HouseScene extends WorldScene<HouseState> {
  private ownerId = '';
  private arriveAt: 'gate' | 'door' = 'gate';
  private dims: HouseDims = { width: 8, height: 6, rooms: 1 };
  private level = 1;
  private style = 'cottage';
  private items: (EditItem & { id: string })[] = [];
  private look = { wallpaper: '', floor: '' };
  private signature = '';
  private seats: StudySeat[] = [];
  private view!: InteriorView;
  private yard!: YardView;
  private inside = false;
  private doorSentAt = 0;
  private ghost: Phaser.GameObjects.Image | null = null;
  /** Green/red footprint under the ghost: can the item go here? */
  private ghostRect: Phaser.GameObjects.Rectangle | null = null;
  private renderedEditVersion = -1;
  private unsubscribeEditor: (() => void) | null = null;
  private leaving = false;
  private myUserId: string | null = null;

  constructor() {
    super('House');
  }

  init(data: HouseSceneData): void {
    this.ownerId = data.ownerId;
    this.arriveAt = data.at ?? 'gate';
    this.leaving = false;
    this.signature = '';
    this.inside = false;
  }

  protected buildWorld(): void {
    // Local session read, no network: who am I (for "is this my house?").
    void supabase.auth.getSession().then(({ data }) => {
      this.myUserId = data.session?.user.id ?? null;
      editor.setMe(this.myUserId);
      this.signature = '';
      if (this.room) this.sync(this.room.state);
    });
    this.view = new InteriorView(this);
    this.yard = new YardView(this);
    this.grid = houseCollisionGrid(this.dims, []);
    this.input.mouse?.disableContextMenu();
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.unsubscribeEditor = editor.subscribe(() => this.renderEditor());
  }

  protected joinRoom(): Promise<Room<unknown, HouseState>> {
    return joinHouse({ ownerId: this.ownerId, at: this.arriveAt });
  }

  protected override onJoinFailed(err: unknown): void {
    showNotice(err instanceof Error ? err.message : 'Could not enter the house.');
    this.exitToTown();
  }

  protected bindWorld(room: Room<unknown, HouseState>): void {
    room.onStateChange((s: HouseState) => this.sync(s));
    this.sync(room.state);
    room.onMessage(ServerMsg.HouseNotice, (n: HouseNoticeMessage) => {
      showNotice(n.message);
      if (n.leave) this.exitToTown();
    });
  }

  /** Mirror the room's house fields; redraw only when the house itself changed. */
  private sync(s: HouseState): void {
    if (!s.width) return;
    const items = s.items.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      room: i.room,
      x: i.x,
      y: i.y,
      placedBy: i.placedBy,
    }));
    const members = [...s.members];
    const signature = JSON.stringify([
      s.level,
      s.width,
      s.height,
      s.rooms,
      s.wallpaper,
      s.floor,
      s.visibility,
      s.exteriorStyle,
      members,
      items,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    uiStore.set({
      house: {
        ownerId: s.ownerId,
        ownerName: s.ownerName,
        isOwner: this.myUserId === s.ownerId,
        isMember: !!this.myUserId && members.includes(this.myUserId),
        level: s.level,
        width: s.width,
        height: s.height,
        rooms: s.rooms,
        visibility: s.visibility,
        exteriorStyle: s.exteriorStyle,
        wallpaper: s.wallpaper,
        floor: s.floor,
      },
    });

    this.dims = { width: s.width, height: s.height, rooms: s.rooms };
    this.level = s.level;
    this.style = s.exteriorStyle;
    this.items = items;
    this.look = { wallpaper: s.wallpaper, floor: s.floor };
    const placements = items.map((i) => ({ ...i, rotation: 0 }));
    const exterior = houseExteriorWidth(s.level);
    this.grid = houseCollisionGrid(this.dims, placements, undefined, exterior);
    this.seats = studySeats(this.dims, placements, undefined, exterior);
    editor.setSource({
      dims: this.dims,
      items: items.map(({ itemId, room, x, y, placedBy }) => ({ itemId, room, x, y, placedBy })),
      wallpaper: s.wallpaper || null,
      floor: s.floor || null,
    });
    this.yard.render(this.dims, this.level, this.style, this.textResolution());
    this.applyZoom();
    this.placeCamera();
    if (!editor.get().active) this.view.render(this.dims, this.look, this.items);
  }

  // -------------------------------------------------------------------------------------------
  // Camera: frame the part you're in (yard or inside); show it whole when it fits, otherwise
  // follow the player.
  // -------------------------------------------------------------------------------------------

  /** The zone the camera frames, in pixels. */
  private zone(): Rect {
    const t = this.inside ? houseWorld.interiorBounds(this.dims) : houseWorld.yardBounds();
    return { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE, w: t.w * TILE_SIZE, h: t.h * TILE_SIZE };
  }

  protected override zoomFor(width: number, height: number): number {
    const z = this.zone();
    const fit = Math.floor(Math.min(width / (z.w + 32), (height - 120) / (z.h + 16)));
    return Math.max(2, Math.min(this.inside ? 5 : 3, Math.max(fit, this.inside ? 2 : 3)));
  }

  protected override onLocalPlayer(_sprite: PlayerSprite): void {
    this.placeCamera();
  }

  private placeCamera(): void {
    const cam = this.cameras.main;
    const z = this.zone();
    if (z.w * cam.zoom <= cam.width && z.h * cam.zoom <= cam.height) {
      cam.stopFollow();
      cam.removeBounds();
      cam.centerOn(z.x + z.w / 2, z.y + z.h / 2);
    } else if (this.local) {
      cam.setBounds(z.x, z.y, z.w, z.h);
      cam.startFollow(this.local, true, 0.15, 0.15);
    }
  }

  /** Re-frame the camera when the player moves between the yard and the inside. */
  private updateZone(): void {
    const inside = houseWorld.isInside(this.pos.x);
    if (inside === this.inside) return;
    this.inside = inside;
    this.applyZoom();
  }

  protected override applyZoom(): void {
    super.applyZoom();
    if (this.view) this.placeCamera();
  }

  // -------------------------------------------------------------------------------------------
  // Walking around
  // -------------------------------------------------------------------------------------------

  protected override canClickPlayers(): boolean {
    return !editor.get().active;
  }

  protected override movementLocked(): boolean {
    return super.movementLocked() || editor.get().active;
  }

  protected use(): boolean {
    if (atFrontDoor(this.pos) || atExit(this.dims, this.pos)) {
      this.useDoor();
      return true;
    }
    return false;
  }

  /** Ask the server to take us through the front door; it moves us and we snap there. */
  private useDoor(): void {
    const now = Date.now();
    if (now - this.doorSentAt < 800) return;
    this.doorSentAt = now;
    this.room?.send(ClientMsg.HouseDoor);
  }

  protected override teleport(x: number, y: number): void {
    super.teleport(x, y);
    this.updateZone();
  }

  protected afterMove(): void {
    this.updateZone();
    if (atGate(this.pos)) {
      this.exitToTown();
      return;
    }
    // Walk up into the front door (keep pressing up on the doorstep), or onto the exit mat.
    const exit = houseWorld.exitTile(this.dims);
    const onMat =
      Math.floor(this.pos.x / TILE_SIZE) === exit.x &&
      Math.floor((this.pos.y - 1) / TILE_SIZE) === exit.y;
    if ((atFrontDoor(this.pos) && this.heldInput.y < 0) || onMat) this.useDoor();

    const tx = Math.floor(this.pos.x / TILE_SIZE);
    const ty = Math.floor((this.pos.y - 1) / TILE_SIZE);
    const seat = this.seats.find((s) => s.tile.x === tx && s.tile.y === ty);
    const current = uiStore.get().nearDesk;
    if ((current?.id ?? null) === (seat?.id ?? null)) return;
    const near: NearDesk | null = seat ? { id: seat.id, table: null } : null;
    uiStore.set({ nearDesk: near, ...(near ? {} : { timerOpen: false, focusError: null }) });
  }

  private exitToTown(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (editor.get().active) editor.stop();
    goToTown();
  }

  // -------------------------------------------------------------------------------------------
  // Edit mode (owner only): green/red ghost, place, pick up
  // -------------------------------------------------------------------------------------------

  private renderEditor(): void {
    const ed = editor.get();
    if (!this.view) return;
    if (ed.active) {
      if (ed.version !== this.renderedEditVersion) {
        this.renderedEditVersion = ed.version;
        this.view.render(ed.dims, { wallpaper: ed.wallpaper, floor: ed.floor }, ed.placements);
      }
    } else if (this.renderedEditVersion !== -1) {
      this.renderedEditVersion = -1;
      this.view.render(this.dims, this.look, this.items);
    }
    this.updateGhost(this.input.activePointer);
  }

  /** The yard and the rooms, for mapping the pointer to layout coordinates. */
  private editRooms(): number[] {
    return [YARD_ROOM, ...Array.from({ length: this.dims.rooms }, (_, i) => i)];
  }

  /** Room and tile under the pointer, with the item anchored at its bottom-centre. */
  private target(pointer: Phaser.Input.Pointer, itemId: string): EditItem | null {
    const item = CATALOG_BY_ID.get(itemId);
    if (!item) return null;
    const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    for (const room of this.editRooms()) {
      const o = houseWorld.roomOrigin(this.dims, room);
      const size = roomDims(this.dims, room);
      const lx = tx - o.x;
      const ly = ty - o.y;
      if (lx < -1 || lx > size.width || ly < -1 || ly > size.height) continue;
      return {
        itemId,
        room,
        x: lx - Math.floor((item.size.w - 1) / 2),
        y: ly - (item.size.h - 1),
      };
    }
    return null;
  }

  private tileUnder(pointer: Phaser.Input.Pointer): { room: number; x: number; y: number } | null {
    const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tx = Math.floor(p.x / TILE_SIZE);
    const ty = Math.floor(p.y / TILE_SIZE);
    for (const room of this.editRooms()) {
      const o = houseWorld.roomOrigin(this.dims, room);
      const size = roomDims(this.dims, room);
      const x = tx - o.x;
      const y = ty - o.y;
      if (x >= 0 && x < size.width && y >= 0 && y < size.height) return { room, x, y };
    }
    return null;
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    const ed = editor.get();
    const item = ed.carrying ? CATALOG_BY_ID.get(ed.carrying) : undefined;
    const target = ed.active && ed.carrying ? this.target(pointer, ed.carrying) : null;
    if (!item || !target) {
      this.ghost?.setVisible(false);
      this.ghostRect?.setVisible(false);
      return;
    }
    const f = itemFrame(this, spriteKey(item.sprite));
    if (!f) return;
    if (!this.ghost)
      this.ghost = this.add.image(0, 0, f.sheet, f.frame).setOrigin(0, 1).setDepth(10_001);
    if (!this.ghostRect)
      this.ghostRect = this.add.rectangle(0, 0, 16, 16).setOrigin(0).setDepth(10_000);
    const o = houseWorld.roomOrigin(this.dims, target.room);
    const left = (o.x + target.x) * TILE_SIZE;
    const top = (o.y + target.y) * TILE_SIZE;
    const color = editor.check(target).ok ? 0x5ee37a : 0xff4d4d;
    this.ghostRect
      .setPosition(left, top)
      .setSize(item.size.w * TILE_SIZE, item.size.h * TILE_SIZE)
      .setFillStyle(color, 0.35)
      .setStrokeStyle(1, color, 0.9)
      .setVisible(true);
    this.ghost
      .setTexture(f.sheet, f.frame)
      .setPosition(left, top + item.size.h * TILE_SIZE)
      .setAlpha(0.85)
      .setVisible(true);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (editor.get().active) this.updateGhost(pointer);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const ed = editor.get();
    if (!ed.active) return;
    if (pointer.rightButtonDown()) {
      editor.drop();
      return;
    }
    if (ed.carrying) {
      if (!ed.dragging) this.tryPlace(pointer, ed.carrying);
      return;
    }
    const tile = this.tileUnder(pointer);
    if (tile) editor.pickUpAt(tile.room, tile.x, tile.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const ed = editor.get();
    if (ed.active && ed.carrying && ed.dragging) this.tryPlace(pointer, ed.carrying);
  }

  private tryPlace(pointer: Phaser.Input.Pointer, itemId: string): void {
    const target = this.target(pointer, itemId);
    if (!target) return;
    editor.place(target);
  }

  protected override escape(): void {
    const ed = editor.get();
    if (ed.active && ed.carrying) editor.drop();
    else super.escape();
  }

  protected override onTeardown(): void {
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.view.clear();
    this.yard.clear();
    this.ghost?.destroy();
    this.ghost = null;
    this.ghostRect?.destroy();
    this.ghostRect = null;
    if (editor.get().active) editor.stop();
    uiStore.set({ house: null, houseSettingsOpen: false });
  }
}
