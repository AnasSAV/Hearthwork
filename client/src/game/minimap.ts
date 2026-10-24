import { useSyncExternalStore } from 'react';

/**
 * Positions for the minimap, published by the town scene a few times a second (cheaper than
 * having React read Phaser every frame).
 */
export interface MinimapState {
  /** World size in px; 0 when there's no minimap for this world. */
  width: number;
  height: number;
  me: { x: number; y: number } | null;
  others: { x: number; y: number; focusing: boolean }[];
}

let state: MinimapState = { width: 0, height: 0, me: null, others: [] };
const listeners = new Set<() => void>();

export const minimap = {
  get: () => state,
  set(next: MinimapState): void {
    state = next;
    listeners.forEach((l) => l());
  },
  clear(): void {
    minimap.set({ width: 0, height: 0, me: null, others: [] });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useMinimap(): MinimapState {
  return useSyncExternalStore(minimap.subscribe, () => state);
}
