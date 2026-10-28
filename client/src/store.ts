import { useSyncExternalStore } from 'react';
import type { FocusEndedMessage, FocusStateMessage, WalletMessage } from '@focus-town/shared';

/** UI-facing state shared between Phaser scenes and React overlays. */
export type ConnectionStatus =
  | { kind: 'loading' }
  | { kind: 'connecting' }
  | { kind: 'waking'; attempt: number }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'error'; message: string };

export interface NearDesk {
  id: string;
  table: string | null;
}

export interface ActiveFocus extends FocusStateMessage {
  /** Date.now() when this state arrived; drives the smooth on-screen clock. */
  receivedAt: number;
}

/** The house the player is in, mirrored from the house room for React panels. */
export interface HouseInfo {
  ownerId: string;
  ownerName: string;
  /** You own this house. */
  isOwner: boolean;
  /** You live here (owner or housemate): you can decorate and change settings. */
  isMember: boolean;
  level: number;
  width: number;
  height: number;
  rooms: number;
  visibility: string;
  exteriorStyle: string;
  wallpaper: string;
  floor: string;
}

/** A running group-table Pomodoro (server times in ms). */
export interface TableTimer {
  plannedMin: number;
  endsAt: number;
  seated: number;
}

export interface UiState {
  connection: ConnectionStatus;
  playerName: string;
  /** encodeAvatar() form of the local player's look. */
  playerAvatar: string;
  playersOnline: number;
  focusingNow: number;
  wallet: WalletMessage | null;
  /** Desk seat the player is standing on, if any. */
  nearDesk: NearDesk | null;
  /** Standing at the Furniture Shop's door. */
  nearShop: boolean;
  shopOpen: boolean;
  inventoryOpen: boolean;
  /** Bumped after purchases so the inventory drawer refetches. */
  inventoryVersion: number;
  /** null in town. */
  house: HouseInfo | null;
  /** The world map (town, your home, friends' and public homes) is open. */
  mapOpen: boolean;
  /** The widget picker (clock, Pomodoro, radio, todo, notes) is open. */
  widgetPickerOpen: boolean;
  /** Travel transition between worlds (see game/navigation). */
  transition: { phase: 'idle' | 'closing' | 'covered' | 'opening'; label: string };
  /** Your zoom adjustment in steps on top of the automatic zoom (saved per browser). */
  zoom: number;
  minimapOpen: boolean;
  houseSettingsOpen: boolean;
  friendsOpen: boolean;
  /** Short message shown as a toast. */
  notice: string | null;
  /** Group-table Pomodoros in the current town room, by table id. */
  tables: Record<string, TableTimer>;
  statsOpen: boolean;
  /** The character editor is open. */
  characterOpen: boolean;
  /** The focus timer panel is open (choosing a block, or running). */
  timerOpen: boolean;
  focus: ActiveFocus | null;
  focusSummary: FocusEndedMessage | null;
  focusError: string | null;
  /** Played by touch (joystick and tappable prompts) rather than keyboard and mouse. */
  touch: boolean;
}

const ZOOM_KEY = 'focus-town:zoom';
export const ZOOM_RANGE = { min: -2, max: 3 } as const;

function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isInteger(z) ? Math.max(ZOOM_RANGE.min, Math.min(ZOOM_RANGE.max, z)) : 0;
  } catch {
    return 0;
  }
}

export function setZoom(z: number): void {
  const zoom = Math.max(ZOOM_RANGE.min, Math.min(ZOOM_RANGE.max, Math.round(z)));
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // Not persisted; fine.
  }
  uiStore.set({ zoom });
}

const initial: UiState = {
  connection: { kind: 'loading' },
  playerName: '',
  playerAvatar: '',
  playersOnline: 0,
  focusingNow: 0,
  wallet: null,
  nearDesk: null,
  nearShop: false,
  shopOpen: false,
  inventoryOpen: false,
  inventoryVersion: 0,
  house: null,
  mapOpen: false,
  widgetPickerOpen: false,
  transition: { phase: 'idle', label: '' },
  zoom: loadZoom(),
  minimapOpen: false,
  houseSettingsOpen: false,
  friendsOpen: false,
  notice: null,
  tables: {},
  statsOpen: false,
  characterOpen: false,
  timerOpen: false,
  focus: null,
  focusSummary: null,
  focusError: null,
  touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
};

let state: UiState = initial;
const listeners = new Set<() => void>();

export const uiStore = {
  get: (): UiState => state,
  set(patch: Partial<UiState>): void {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  reset(): void {
    state = { ...initial, zoom: state.zoom, touch: state.touch };
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(uiStore.subscribe, () => select(uiStore.get()));
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a toast for a few seconds. */
export function showNotice(message: string): void {
  clearTimeout(noticeTimer);
  uiStore.set({ notice: message });
  noticeTimer = setTimeout(() => uiStore.set({ notice: null }), 5000);
}

// Dev-only console/test handle, e.g. `__ui.set({ shopOpen: true })`.
if (import.meta.env.DEV) (window as unknown as { __ui: typeof uiStore }).__ui = uiStore;
