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
}

const initial: UiState = {
  connection: { kind: 'loading' },
  playerName: '',
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
    state = initial;
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
