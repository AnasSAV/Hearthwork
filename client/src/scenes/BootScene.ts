import Phaser from 'phaser';
import { loadCharacterAtlases } from '../game/characters';
import { HOUSES_KEY } from '../game/exteriors';
import { SHEETS } from '../game/frames';
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
    this.load.setPath('assets');
    this.load.tilemapTiledJSON(TOWN_MAP_KEY, 'maps/town.json');
    this.load.image(TOWN_TILESET_KEY, 'tilesets/town.png');
    this.load.atlas(HOUSES_KEY, 'sprites/houses.png', 'sprites/houses.json');
    this.load.atlas(TOWN_ANIMS_KEY, 'sprites/town-anims.png', 'sprites/town-anims.json');
    // House interiors (catalog sprites).
    this.load.image(SHEETS.furniture, 'tilesets/furniture.png');
    this.load.image(SHEETS.room, 'tilesets/room.png');
    this.load.image(SHEETS.yard, 'tilesets/yard.png');
    loadCharacterAtlases(this.load);
  }

  /** Players start at home, in their yard; the town if their home can't be found. */
  create(): void {
    fetchMyHome()
      .then((home) => this.scene.start('House', { ownerId: home.owner_id, at: 'door' }))
      .catch(() => this.scene.start('Town'));
  }
}
