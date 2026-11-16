import type Phaser from 'phaser';
import { GAMES, type GameId } from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { uiStore } from '../store';

/**
 * Moving between the town and homes. Each world is its own Phaser scene with its own Colyseus
 * room; switching stops one scene (which leaves its room) and starts the other. A transition
 * covers the swap: the view irises closed on you, clouds drift past with the destination's
 * name, and it opens again once you've arrived (your character is in the new world).
 */
let game: Phaser.Game | null = null;

export interface HouseSceneData {
  ownerId: string;
  /** Appear at the garden gate (default: arriving from town or the map) or on the doorstep. */
  at?: 'gate' | 'door';
  /** Shown during the transition, e.g. "Home" or "Ana's home". */
  label?: string;
}

export type TownSceneData = Record<string, never>;

export interface GameSceneData {
  game: GameId;
}

export function attachGame(g: Phaser.Game | null): void {
  game = g;
}

/** How long the iris takes to close before the scenes swap. */
const CLOSE_MS = 650;
/** Never stay covered longer than this, even if arriving fails. */
const MAX_COVER_MS = 9000;
/** Stay covered at least this long, so the destination card is seen even on fast loads. */
const MIN_COVER_MS = 800;
let coverTimer: ReturnType<typeof setTimeout> | null = null;
let coveredAt = 0;

function switchTo(key: 'Town' | 'House' | 'Game', data: object, label: string): void {
  if (!game) return;
  const g = game;
  if (uiStore.get().transition.phase === 'closing') return;
  uiStore.set({ transition: { phase: 'closing', label } });
  sfx.play('whoosh');
  setTimeout(() => {
    for (const k of ['Town', 'House', 'Game'] as const) {
      if (k !== key && g.scene.isActive(k)) g.scene.stop(k);
    }
    if (g.scene.isActive(key)) g.scene.getScene(key).scene.restart(data);
    else g.scene.start(key, data);
    coverWorld(label);
  }, CLOSE_MS);
}

/** Start covered (first load): the iris opens when you arrive. */
export function coverWorld(label: string): void {
  coveredAt = Date.now();
  uiStore.set({ transition: { phase: 'covered', label } });
  if (coverTimer) clearTimeout(coverTimer);
  coverTimer = setTimeout(revealWorld, MAX_COVER_MS);
}

/** The new world is ready (or failed): open the iris. */
export function revealWorld(): void {
  const t = uiStore.get().transition;
  if (t.phase !== 'covered') return;
  const wait = MIN_COVER_MS - (Date.now() - coveredAt);
  if (wait > 0) {
    setTimeout(revealWorld, wait);
    return;
  }
  if (coverTimer) clearTimeout(coverTimer);
  coverTimer = null;
  uiStore.set({ transition: { phase: 'opening', label: t.label } });
  setTimeout(() => {
    if (uiStore.get().transition.phase === 'opening') {
      uiStore.set({ transition: { phase: 'idle', label: '' } });
    }
  }, 800);
}

export function goToHouse(data: HouseSceneData): void {
  switchTo('House', data, data.label ?? 'Home');
}

export function goToGame(data: GameSceneData): void {
  switchTo('Game', data, GAMES[data.game].name);
}

export function goToTown(): void {
  switchTo('Town', {}, 'Town');
}
