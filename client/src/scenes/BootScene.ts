import Phaser from 'phaser';
import { CHARACTERS_KEY, createCharacterAnims } from '../game/characters';
import { uiStore } from '../store';

export const TOWN_MAP_KEY = 'town';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    uiStore.set({ connection: { kind: 'loading' } });
    this.load.setPath('assets');
    this.load.tilemapTiledJSON(TOWN_MAP_KEY, 'maps/town.json');
    // Keys match the tileset names inside the Tiled map.
    this.load.image('tinytown', 'tilesets/tinytown.png');
    this.load.image('indoor', 'tilesets/indoor.png');
    this.load.spritesheet(CHARACTERS_KEY, 'sprites/characters.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
  }

  create(): void {
    createCharacterAnims(this.anims);
    this.scene.start('Town');
  }
}
