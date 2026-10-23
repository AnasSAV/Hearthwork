import { useSyncExternalStore } from 'react';
import {
  CATALOG_BY_ID,
  canPlace,
  coveredTiles,
  validateLayout,
  type HouseDims,
  type PlaceCheck,
  type Placement,
} from '@focus-town/shared';
import { roomActions } from '../net/roomBridge';
import { fetchInventory } from '../net/shop';
import { supabase } from '../net/supabase';

export interface EditItem {
  itemId: string;
  room: number;
  x: number;
  y: number;
}

/** The house as last loaded from the room; edit mode starts from a copy of it. */
export interface HouseLayout {
  dims: HouseDims;
  items: EditItem[];
  wallpaper: string | null;
  floor: string | null;
}

export interface EditorState {
  active: boolean;
  dims: HouseDims;
  placements: EditItem[];
  wallpaper: string | null;
  floor: string | null;
  /** item id → quantity owned (from the inventory). */
  owned: Map<string, number>;
  /** Item attached to the cursor, waiting to be placed. */
  carrying: string | null;
  /** Carrying started with a press in the drawer: release over the room places it. */
  dragging: boolean;
  saving: boolean;
  error: string | null;
  /** Bumped whenever the layout changes, so the scene knows to redraw. */
  version: number;
}

const toPlacement = (i: EditItem): Placement => ({ ...i, rotation: 0 });

let source: HouseLayout = {
  dims: { width: 8, height: 6, rooms: 1 },
  items: [],
  wallpaper: null,
  floor: null,
};
let state: EditorState = {
  active: false,
  dims: source.dims,
  placements: [],
  wallpaper: null,
  floor: null,
  owned: new Map(),
  carrying: null,
  dragging: false,
  saving: false,
  error: null,
  version: 0,
};
const listeners = new Set<() => void>();

function set(patch: Partial<EditorState>, layoutChanged = false): void {
  state = { ...state, ...patch, version: state.version + (layoutChanged ? 1 : 0) };
  listeners.forEach((l) => l());
}

/** Topmost-first order for picking things up. */
const PICK_ORDER = ['surface', 'floor', 'wall', 'rug'];

export const editor = {
  get: (): EditorState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Called by the house scene whenever the room's layout changes. */
  setSource(layout: HouseLayout): void {
    source = layout;
  },

  async begin(): Promise<void> {
    set(
      {
        active: true,
        dims: source.dims,
        placements: source.items.map((i) => ({ ...i })),
        wallpaper: source.wallpaper,
        floor: source.floor,
        carrying: null,
        dragging: false,
        error: null,
      },
      true,
    );
    try {
      set({ owned: await fetchInventory() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  stop(): void {
    set({ active: false, carrying: null, dragging: false, saving: false, error: null }, true);
  },

  /** How many more of `itemId` can be placed. */
  available(itemId: string): number {
    const placed = state.placements.filter((p) => p.itemId === itemId).length;
    const carried = state.carrying === itemId ? 1 : 0;
    return (state.owned.get(itemId) ?? 0) - placed - carried;
  },

  carry(itemId: string, dragging: boolean): void {
    if (state.carrying !== itemId && editor.available(itemId) <= 0) return;
    set({ carrying: itemId, dragging, error: null });
  },

  /** The drag ended outside the room: keep carrying, place with a click. */
  stopDragging(): void {
    set({ dragging: false });
  },

  /** Put the carried item back in the inventory. */
  drop(): void {
    set({ carrying: null, dragging: false });
  },

  check(p: EditItem): PlaceCheck {
    return canPlace(state.dims, state.placements.map(toPlacement), toPlacement(p));
  },

  /** Place the carried item at `p` if the rules allow it. */
  place(p: EditItem): PlaceCheck {
    const check = editor.check(p);
    if (!check.ok) return check;
    set(
      { placements: [...state.placements, p], carrying: null, dragging: false, error: null },
      true,
    );
    return check;
  },

  /**
   * Pick up whatever is on top at a tile. Lifting a table also returns anything standing on it
   * to the inventory (nothing is ever destroyed).
   */
  pickUpAt(room: number, x: number, y: number): boolean {
    const hits = state.placements
      .map((p, index) => ({ p, index, item: CATALOG_BY_ID.get(p.itemId) }))
      .filter(
        ({ p, item }) =>
          item &&
          p.room === room &&
          coveredTiles(item, toPlacement(p)).some((t) => t.x === x && t.y === y),
      )
      .sort((a, b) => PICK_ORDER.indexOf(a.item!.layer) - PICK_ORDER.indexOf(b.item!.layer));
    const hit = hits[0];
    if (!hit) return false;
    let rest = state.placements.filter((_, i) => i !== hit.index);
    if (hit.item!.surfaceHost) {
      // Drop surface items that no longer have a table under them.
      rest = rest.filter(
        (p) =>
          CATALOG_BY_ID.get(p.itemId)?.layer !== 'surface' ||
          canPlace(state.dims, rest.filter((q) => q !== p).map(toPlacement), toPlacement(p)).ok,
      );
    }
    set({ placements: rest, carrying: hit.p.itemId, dragging: false, error: null }, true);
    return true;
  },

  setLook(look: { wallpaper?: string | null; floor?: string | null }): void {
    set(look, true);
  },

  async save(): Promise<boolean> {
    const local = validateLayout(state.dims, state.placements.map(toPlacement));
    if (!local.ok) {
      set({ error: local.reason });
      return false;
    }
    set({ saving: true, error: null });
    const { error } = await supabase.rpc('save_layout', {
      p_layout: {
        wallpaper: state.wallpaper,
        floor: state.floor,
        items: state.placements.map((p) => ({
          item_id: p.itemId,
          room: p.room,
          x: p.x,
          y: p.y,
          rotation: 0,
        })),
      },
    });
    if (error) {
      set({ saving: false, error: error.message });
      return false;
    }
    roomActions.reloadHouse();
    editor.stop();
    return true;
  },
};

export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => select(state));
}
