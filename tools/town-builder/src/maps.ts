/** The maps the builder edits: the town and each mini-game's map. */
export type MapId = 'town' | 'lake' | 'rapids' | 'meadow' | 'cove';

export interface MapInfo {
  id: MapId;
  name: string;
  /** What this map is for, shown under the switcher. */
  blurb: string;
}

export const MAPS: MapInfo[] = [
  { id: 'town', name: 'Town', blurb: 'Where everyone studies and shops.' },
  {
    id: 'lake',
    name: 'Mirror Lake (fishing)',
    blurb: 'Players fish from any bank or pier edge next to water.',
  },
  {
    id: 'rapids',
    name: 'Rushwater Rapids (rafting)',
    blurb:
      'Rafts go in at the Raft launch and race down the river to the Finish line. Rocks in the water are obstacles; Bonus buoys take 2 s off.',
  },
  {
    id: 'meadow',
    name: 'Butterfly Meadow',
    blurb: 'Butterflies gather at the flower beds.',
  },
  {
    id: 'cove',
    name: 'Treasure Cove',
    blurb: 'Treasure is buried somewhere on the sand.',
  },
];

export const mapInfo = (id: MapId): MapInfo => MAPS.find((m) => m.id === id)!;
