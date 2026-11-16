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
    coverWorld('Hearthwork');
    this.load.setPath('assets');
    // The town's art changes whenever the town builder saves, under the same file names, so ask
    // for the version the map names (cached copies of an older tileset would scramble the town).
    this.load.once(
      `filecomplete-tilemapJSON-${TOWN_MAP_KEY}`,
      (_key: string, _type: string, data: { properties?: { name: string; value: unknown }[] }) => {
        const version = data.properties?.find((p) => p.name === 'version')?.value;
        const v = typeof version === 'string' ? `?v=${encodeURIComponent(version)}` : '';
        this.load.image(TOWN_TILESET_KEY, `tilesets/town.png${v}`);
        this.load.atlas(
          TOWN_ANIMS_KEY,
          `sprites/town-anims.png${v}`,
          `sprites/town-anims.json${v}`,
        );
        this.load.atlas(TREES_KEY, `sprites/town-trees.png${v}`, `sprites/town-trees.json${v}`);
      },
    );
    this.load.tilemapTiledJSON(TOWN_MAP_KEY, 'maps/town.json');
    this.load.atlas(HOUSES_KEY, 'sprites/houses.png', 'sprites/houses.json');
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
