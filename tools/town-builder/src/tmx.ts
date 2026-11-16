import { T } from './kit';

export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  margin: number;
  spacing: number;
}

export interface TiledLayer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  width?: number;
  height?: number;
  data?: number[];
  draworder?: string;
  objects?: TiledObject[];
}

export interface TiledMap {
  compressionlevel: number;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: boolean;
  orientation: string;
  renderorder: string;
  tiledversion: string;
  type: string;
  version: string;
  nextlayerid: number;
  nextobjectid: number;
  properties?: TiledProperty[];
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

/** The map as a Tiled .tmx (CSV layers), written next to the JSON so Tiled can open it too. */
export function toTmx(map: TiledMap): string {
  const esc = (s: unknown) =>
    String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const { width: W, height: H } = map;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" ` +
      `width="${W}" height="${H}" tilewidth="${T}" tileheight="${T}" infinite="0" ` +
      `nextlayerid="${map.nextlayerid}" nextobjectid="${map.nextobjectid}">`,
  ];
  for (const ts of map.tilesets) {
    out.push(
      ` <tileset firstgid="${ts.firstgid}" name="${ts.name}" tilewidth="${T}" ` +
        `tileheight="${T}" tilecount="${ts.tilecount}" columns="${ts.columns}">\n` +
        `  <image source="${ts.image}" width="${ts.imagewidth}" height="${ts.imageheight}"/>\n` +
        ` </tileset>`,
    );
  }
  for (const l of map.layers) {
    if (l.type === 'tilelayer' && l.data) {
      const rows: string[] = [];
      for (let y = 0; y < H; y++) rows.push(l.data.slice(y * W, (y + 1) * W).join(','));
      out.push(
        ` <layer id="${l.id}" name="${l.name}" width="${W}" height="${H}"${l.visible ? '' : ' visible="0"'}>\n` +
          `  <data encoding="csv">\n${rows.join(',\n')}\n</data>\n </layer>`,
      );
    } else if (l.type === 'objectgroup') {
      out.push(` <objectgroup id="${l.id}" name="${l.name}">`);
      for (const o of l.objects ?? []) {
        const size = o.point ? '' : ` width="${o.width}" height="${o.height}"`;
        const head = `  <object id="${o.id}" name="${esc(o.name)}" type="${o.type}" x="${o.x}" y="${o.y}"${size}`;
        const inner: string[] = [];
        if (o.properties?.length) {
          inner.push('   <properties>');
          for (const p of o.properties) {
            const kind = p.type === 'string' ? '' : ` type="${p.type}"`;
            inner.push(`    <property name="${esc(p.name)}"${kind} value="${esc(p.value)}"/>`);
          }
          inner.push('   </properties>');
        }
        if (o.point) inner.push('   <point/>');
        out.push(head + (inner.length ? `>\n${inner.join('\n')}\n  </object>` : '/>'));
      }
      out.push(' </objectgroup>');
    }
  }
  out.push('</map>', '');
  return out.join('\n');
}
