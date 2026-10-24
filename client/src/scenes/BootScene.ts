import Phaser from 'phaser';
import { loadCharacterAtlases } from '../game/characters';
import { TREES_KEY } from '../game/life';
import { loadUiAtlas } from '../game/uiAtlas';
import { HOUSES_KEY } from '../game/exteriors';
import { SHEETS } from '../game/frames';
import { coverWorld } from '../game/navigation';
import { fetchMyHome } from '../net/houses';
import { uiStore } from '../store';

export const TOWN_MAP_KEY = 'town';
/** Matches the tileset name inside town.json (tools/art/build_town.py). */
export const TOWN_TILESET_KEY = 'town';
/** Animated town pieces (tools/art/build_town.py). */
export const TOWN_ANIMS_KEY = 'town-anims';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    uiStore.set({ connection: { kind: 'loading' } });
    coverWorld('Focus Town');
    this.load.setPath('assets');
    this.load.tilemapTiledJSON(TOWN_MAP_KEY, 'maps/town.json');
    this.load.image(TOWN_TILESET_KEY, 'tilesets/town.png');
    this.load.atlas(HOUSES_KEY, 'sprites/houses.png', 'sprites/houses.json');
    this.load.atlas(TOWN_ANIMS_KEY, 'sprites/town-anims.png', 'sprites/town-anims.json');
    this.load.atlas(TREES_KEY, 'sprites/town-trees.png', 'sprites/town-trees.json');
    // House interiors (catalog sprites).
    this.load.image(SHEETS.furniture, 'tilesets/furniture.png');
    this.load.image(SHEETS.room, 'tilesets/room.png');
    this.load.image(SHEETS.yard, 'tilesets/yard.png');
    loadCharacterAtlases(this.load);
    loadUiAtlas(this.load);
  }

  /** Players start at home, in their yard; the town if their home can't be found. */
  create(): void {
    // Name tags and bubbles use the web font; wait for it so they don't render in a fallback.
    const fonts = document.fonts.load('800 12px Nunito').catch(() => undefined);
    Promise.all([fetchMyHome(), fonts])
      .then(([home]) => this.scene.start('House', { ownerId: home.owner_id, at: 'door' }))
      .catch(() => this.scene.start('Town'));
  }
}
