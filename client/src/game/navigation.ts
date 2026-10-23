import type Phaser from 'phaser';

/**
 * Moving between the town and houses. Each world is its own Phaser scene with its own
 * Colyseus room; switching stops one scene (which leaves its room) and starts the other.
 */
let game: Phaser.Game | null = null;

export interface HouseSceneData {
  ownerId: string;
  /** Appear at the garden gate (default: arriving from town or the map) or on the doorstep. */
  at?: 'gate' | 'door';
}

export type TownSceneData = Record<string, never>;

export function attachGame(g: Phaser.Game | null): void {
  game = g;
}

function switchTo(key: 'Town' | 'House', data: object): void {
  if (!game) return;
  for (const k of ['Town', 'House'] as const) {
    if (k !== key && game.scene.isActive(k)) game.scene.stop(k);
  }
  if (game.scene.isActive(key)) game.scene.getScene(key).scene.restart(data);
  else game.scene.start(key, data);
}

export function goToHouse(data: HouseSceneData): void {
  switchTo('House', data);
}

export function goToTown(data: TownSceneData = {}): void {
  switchTo('Town', data);
}
