import type Phaser from 'phaser';
import { Callbacks, type Room } from '@colyseus/sdk';
import {
  collisionGridFromTiled,
  findObjects,
  getProperty,
  MapObjectType,
  type LotState,
  type TableTimerState,
  type TiledMap,
  type TiledObject,
  type TownState,
} from '@focus-town/shared';
import { LotView } from '../game/exteriors';
import { goToHouse, type TownSceneData } from '../game/navigation';
import { joinTown } from '../net/colyseus';
import { supabase } from '../net/supabase';
import { uiStore, type NearDesk, type NearLot, type TableTimer } from '../store';
import { TOWN_MAP_KEY } from './BootScene';
import { WorldScene } from './WorldScene';

interface Door {
  x: number;
  y: number;
}

interface Plot {
  index: number;
  door: Door;
  view: LotView;
}

/** True if feet at `p` are on the doorstep (the tile right below `door`). */
const onDoorstep = (door: Door, p: { x: number; y: number }) =>
  Math.abs(p.x - door.x) <= 10 && p.y > door.y && p.y <= door.y + 16;

export class TownScene extends WorldScene<TownState> {
  private desks: TiledObject[] = [];
  private shopDoor: Door | null = null;
  private plots = new Map<number, Plot>();
  private lots = new Map<number, LotState>();
  private fromPlot: number | undefined;
  private myUserId: string | null = null;

  constructor() {
    super('Town');
  }

  init(data: TownSceneData): void {
    this.fromPlot = data.fromPlot;
  }

  protected buildWorld(): void {
    uiStore.set({ house: null });
    void supabase.auth
      .getSession()
      .then(({ data }) => (this.myUserId = data.session?.user.id ?? null));

    const map = this.make.tilemap({ key: TOWN_MAP_KEY });
    const tilesets = [map.addTilesetImage('tinytown'), map.addTilesetImage('indoor')].filter(
      (t): t is Phaser.Tilemaps.Tileset => t !== null,
    );
    for (const name of ['ground', 'decor', 'buildings'])
      map.createLayer(name, tilesets)?.setDepth(-10);
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
          .setDepth(-5),
      );
    }
    const shop = buildings.find((b) => b.name === 'shop');
    this.shopDoor = shop ? doorOf(shop) : null;

    this.plots = new Map();
    this.lots = new Map();
    for (const p of findObjects(mapData.data, MapObjectType.Plot)) {
      const index = getProperty<number>(p, 'plotIndex');
      const door = doorOf(p);
      if (index === undefined || !door) continue;
      const view = new LotView(this, { x: p.x, y: p.y }, this.textResolution());
      this.labels.push(view.label);
      this.plots.set(index, { index, door, view });
    }
  }

  protected joinRoom(): Promise<Room<unknown, TownState>> {
    return joinTown(this.fromPlot !== undefined ? { fromPlot: this.fromPlot } : {});
  }

  protected bindWorld(room: Room<unknown, TownState>): void {
    const callbacks = Callbacks.get(room);
    const draw = (lot: LotState) => {
      this.lots.set(lot.plotIndex, lot);
      this.plots.get(lot.plotIndex)?.view.show(lot);
    };
    callbacks.onAdd('lots', (lot: LotState) => {
      draw(lot);
      callbacks.onChange(lot, () => draw(lot));
    });
    callbacks.onRemove('lots', (lot: LotState) => {
      this.lots.delete(lot.plotIndex);
      this.plots.get(lot.plotIndex)?.view.show(null);
    });

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
    if (ui.nearLot) {
      goToHouse({ ownerId: ui.nearLot.ownerId, fromPlot: ui.nearLot.plotIndex });
      return true;
    }
    return false;
  }

  protected afterMove(): void {
    this.updateNearDesk();
    const nearShop = !!this.shopDoor && onDoorstep(this.shopDoor, this.pos);
    if (uiStore.get().nearShop !== nearShop) uiStore.set({ nearShop });
    this.updateNearLot();
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

  private updateNearLot(): void {
    let near: NearLot | null = null;
    for (const plot of this.plots.values()) {
      const lot = this.lots.get(plot.index);
      if (lot && onDoorstep(plot.door, this.pos)) {
        near = {
          plotIndex: plot.index,
          ownerId: lot.ownerId,
          ownerName: lot.ownerName,
          isMine: lot.ownerId === this.myUserId,
        };
        break;
      }
    }
    const current = uiStore.get().nearLot;
    if ((current?.plotIndex ?? null) !== (near?.plotIndex ?? null)) uiStore.set({ nearLot: near });
  }

  protected override onTeardown(): void {
    uiStore.set({ nearShop: false, nearLot: null, shopOpen: false, tables: {} });
  }
}

function doorOf(o: TiledObject): Door | null {
  const x = getProperty<number>(o, 'doorX');
  const y = getProperty<number>(o, 'doorY');
  return x !== undefined && y !== undefined ? { x, y } : null;
}
