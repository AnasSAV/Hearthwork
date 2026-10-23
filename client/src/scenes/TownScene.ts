import { Callbacks, type Room } from '@colyseus/sdk';
import {
  collisionGridFromTiled,
  findObjects,
  getProperty,
  MapObjectType,
  type TableTimerState,
  type TiledMap,
  type TiledObject,
  type TownState,
} from '@focus-town/shared';
import { ABOVE_DEPTH, GROUND_DEPTH } from '../game/depths';
import { joinTown } from '../net/colyseus';
import { uiStore, type NearDesk, type TableTimer } from '../store';
import { TOWN_ANIMS_KEY, TOWN_MAP_KEY, TOWN_TILESET_KEY } from './BootScene';
import { WorldScene } from './WorldScene';

interface Door {
  x: number;
  y: number;
}

/** True if feet at `p` are on the doorstep (the tile right below `door`). */
const onDoorstep = (door: Door, p: { x: number; y: number }) =>
  Math.abs(p.x - door.x) <= 10 && p.y > door.y && p.y <= door.y + 16;

export class TownScene extends WorldScene<TownState> {
  private desks: TiledObject[] = [];
  private shopDoor: Door | null = null;

  constructor() {
    super('Town');
  }

  protected buildWorld(): void {
    uiStore.set({ house: null });

    const map = this.make.tilemap({ key: TOWN_MAP_KEY });
    const tileset = map.addTilesetImage(TOWN_TILESET_KEY);
    if (!tileset) throw new Error('town tileset missing');
    for (const name of ['ground', 'paths', 'decor', 'below', 'below2'])
      map.createLayer(name, tileset)?.setDepth(GROUND_DEPTH);
    // Tree tops and lamp heads: drawn over players walking behind them.
    for (const name of ['above', 'above2']) map.createLayer(name, tileset)?.setDepth(ABOVE_DEPTH);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const mapData = this.cache.tilemap.get(TOWN_MAP_KEY) as { data: TiledMap };
    this.grid = collisionGridFromTiled(mapData.data);
    this.desks = findObjects(mapData.data, MapObjectType.Desk);

    const buildings = findObjects(mapData.data, MapObjectType.Building);
    for (const b of buildings) {
      const label = getProperty<string>(b, 'label');
      if (!label) continue;
      this.labels.push(
        this.add
          .text(b.x + b.width / 2, b.y - 2, label, {
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: '7px',
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
    const shop = buildings.find((b) => b.name === 'shop');
    this.shopDoor = shop ? doorOf(shop) : null;

    // Animated pieces (flags, fish, a fountain): `anim` objects, frames "<name>:<i>".
    for (const o of findObjects(mapData.data, MapObjectType.Anim)) {
      const frames = getProperty<number>(o, 'frames') ?? 1;
      const key = `town-anim:${o.name}`;
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: Array.from({ length: frames }, (_, i) => ({
            key: TOWN_ANIMS_KEY,
            frame: `${o.name}:${i}`,
          })),
          frameRate: getProperty<number>(o, 'fps') ?? 8,
          repeat: -1,
        });
      }
      const bottom = o.y + o.height;
      this.add
        .sprite(o.x, bottom, TOWN_ANIMS_KEY, `${o.name}:0`)
        .setOrigin(0, 1)
        .setDepth(bottom)
        .play({ key, startFrame: Math.floor(Math.random() * frames) });
    }
  }

  protected joinRoom(): Promise<Room<unknown, TownState>> {
    return joinTown();
  }

  protected bindWorld(room: Room<unknown, TownState>): void {
    const callbacks = Callbacks.get(room);
    // Group-table Pomodoros for the focus panel.
    const syncTables = () => {
      const tables: Record<string, TableTimer> = {};
      room.state.tables.forEach((t: TableTimerState, id: string) => {
        tables[id] = { plannedMin: t.plannedMin, endsAt: t.endsAt, seated: t.seated };
      });
      uiStore.set({ tables });
    };
    callbacks.onAdd('tables', (t: TableTimerState) => {
      syncTables();
      callbacks.onChange(t, syncTables);
    });
    callbacks.onRemove('tables', syncTables);
  }

  protected use(): boolean {
    const ui = uiStore.get();
    if (ui.nearShop) {
      uiStore.set({ shopOpen: true });
      return true;
    }
    return false;
  }

  protected afterMove(): void {
    this.updateNearDesk();
    const nearShop = !!this.shopDoor && onDoorstep(this.shopDoor, this.pos);
    if (uiStore.get().nearShop !== nearShop) uiStore.set({ nearShop });
  }

  private updateNearDesk(): void {
    const desk = this.desks.find(
      (d) =>
        this.pos.x >= d.x &&
        this.pos.x < d.x + d.width &&
        this.pos.y > d.y &&
        this.pos.y <= d.y + d.height,
    );
    const current = uiStore.get().nearDesk;
    if ((current?.id ?? null) === (desk?.name ?? null)) return;
    const near: NearDesk | null = desk
      ? { id: desk.name, table: getProperty<string>(desk, 'table') ?? null }
      : null;
    uiStore.set({ nearDesk: near, ...(near ? {} : { timerOpen: false, focusError: null }) });
  }

  protected override onTeardown(): void {
    uiStore.set({ nearShop: false, shopOpen: false, tables: {} });
  }
}

function doorOf(o: TiledObject): Door | null {
  const x = getProperty<number>(o, 'doorX');
  const y = getProperty<number>(o, 'doorY');
  return x !== undefined && y !== undefined ? { x, y } : null;
}
