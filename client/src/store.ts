import { useSyncExternalStore } from 'react';

/** UI-facing state shared between Phaser scenes and React overlays. */
export type ConnectionStatus =
  | { kind: 'loading' }
  | { kind: 'connecting' }
  | { kind: 'waking'; attempt: number }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'error'; message: string };

export interface UiState {
  connection: ConnectionStatus;
  playerName: string;
  playersOnline: number;
  /** Desk/seat the player is standing on, if any (Phase 2 opens the timer from here). */
  nearDesk: string | null;
}

let state: UiState = {
  connection: { kind: 'loading' },
  playerName: '',
  playersOnline: 0,
  nearDesk: null,
};
const listeners = new Set<() => void>();

export const uiStore = {
  get: (): UiState => state,
  set(patch: Partial<UiState>): void {
    state = { ...state, ...patch };
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
