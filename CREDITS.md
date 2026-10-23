# Credits

All art is CC0 (public domain) by **Kenney** (www.kenney.nl). Credit isn't required, but
it's deserved. Support Kenney at https://kenney.nl/support.

| File in `client/public/assets/` | Source pack       | Download page                              | How it was derived                                                                                                                                                                 |
| ------------------------------- | ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tilesets/tinytown.png`         | Tiny Town 1.1     | https://kenney.nl/assets/tiny-town         | `Tilemap/tilemap_packed.png` copied unchanged (12×11 tiles, 16×16, no spacing)                                                                                                     |
| `tilesets/indoor.png`           | Roguelike Indoors | https://kenney.nl/assets/roguelike-indoors | `Tilesheets/roguelikeIndoor_transparent.png` repacked without the 1px spacing (27×18 tiles, 16×16)                                                                                 |
| `sprites/characters.png`        | RPG Urban Pack    | https://kenney.nl/assets/rpg-urban-pack    | The 6 character columns (tiles 23–26 of each row in `Tilemap/tilemap_packed.png`) cut into a 4×18 sheet: columns = down, up, left, right; 3 rows per avatar = idle, walk A, walk B |
| `tilesets/collision.png`        | (ours)            |                                            | 16×16 translucent red marker tile for the hidden `collision` layer in Tiled                                                                                                        |
| `tilesets/house.png`            | (ours)            |                                            | 4 hand-drawn 16×16 tiles: default plank floor, plaster wall, outer wall, door mat                                                                                                  |

## Maps

- `maps/town.tmx` (Tiled) and `maps/town.json` (Phaser and server) were bootstrapped by
  `tools/maps/build-town.ts` from the tilesets above. Edit the `.tmx` in
  [Tiled](https://www.mapeditor.org/) and re-export JSON with tilesets embedded.

## Audio

- The radio's default tracks and the ambient sounds are generated live in the browser with
  WebAudio (`client/src/audio/`). They are original to this project (CC0); no audio files are
  shipped. Any real tracks added to `client/public/radio/playlist.json` must be license-cleared,
  with the license recorded in their `license` field.

## Code references

- Patterns borrowed (not code) from [SkyOffice](https://github.com/kevinshen56714/SkyOffice) (MIT).
- Movement prediction follows the official
  [Colyseus + Phaser tutorial](https://docs.colyseus.io/learn/tutorial/phaser).
