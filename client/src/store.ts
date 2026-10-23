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

export interface UiState {
  connection: ConnectionStatus;
  playerName: string;
  playersOnline: number;
  focusingNow: number;
  wallet: WalletMessage | null;
  /** Desk seat the player is standing on, if any. */
  nearDesk: NearDesk | null;
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
