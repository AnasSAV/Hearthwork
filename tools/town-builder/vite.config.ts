import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The town builder: a local-only page (127.0.0.1:5180) for laying out the town. It is never built
 * or deployed. `npm run editor` serves it with a small dev-only API that reads the layout and, on
 * save, writes the layout plus the map files the game loads.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const assets = fileURLToPath(new URL('../../client/public/assets', import.meta.url));
const layoutFile = join(root, 'town.layout.json');
const backups = join(root, 'backups');
const PORT = 5180;
const ORIGIN = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`);
const KEEP_BACKUPS = 20;

/** Everything a save writes, relative to client/public/assets (backed up first). */
const OUTPUTS = [
  'maps/town.json',
  'maps/town.tmx',
  'tilesets/town.png',
  'sprites/town-trees.png',
  'sprites/town-trees.json',
  'sprites/town-anims.png',
  'sprites/town-anims.json',
  'sprites/town-map.png',
];

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error('Too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface SaveBody {
  layout: { width: number; height: number; ground: string[]; pieces: unknown[] };
  map: { width: number; height: number; layers: unknown[] };
  tmx: string;
  tileset: string;
  trees: { png: string; json: string };
  anims: { png: string; json: string };
  picture: string;
}

const PNG = 'data:image/png;base64,';
const isPng = (s: unknown): s is string => typeof s === 'string' && s.startsWith(PNG);
const png = (s: string) => Buffer.from(s.slice(PNG.length), 'base64');

function isSaveBody(b: unknown): b is SaveBody {
  const s = b as SaveBody | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    Number.isInteger(s.layout?.width) &&
    Array.isArray(s.layout?.ground) &&
    Array.isArray(s.layout?.pieces) &&
    Number.isInteger(s.map?.width) &&
    Array.isArray(s.map?.layers) &&
    typeof s.tmx === 'string' &&
    s.tmx.startsWith('<?xml') &&
    isPng(s.tileset) &&
    isPng(s.trees?.png) &&
    typeof s.trees?.json === 'string' &&
    isPng(s.anims?.png) &&
    typeof s.anims?.json === 'string' &&
    isPng(s.picture)
  );
}

async function backup(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(backups, stamp);
  await mkdir(dir, { recursive: true });
  for (const rel of OUTPUTS) {
    await copyFile(join(assets, rel), join(dir, rel.replace('/', '__'))).catch(() => undefined);
  }
  await copyFile(layoutFile, join(dir, 'town.layout.json')).catch(() => undefined);
  const old = (await readdir(backups)).sort();
  for (const d of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) {
    await rm(join(backups, d), { recursive: true, force: true });
  }
  return dir;
}

function townApi(): Plugin {
  return {
    name: 'focus-town:town-api',
    configureServer(server) {
      server.middlewares.use('/api/layout', (req, res) => {
        void (async () => {
          try {
            res.setHeader('cache-control', 'no-store');
            res.setHeader('content-type', 'application/json');
            res.end(await readFile(layoutFile));
          } catch {
            send(res, 404, { error: 'No layout yet' });
          }
        })();
      });
      server.middlewares.use('/api/save', (req, res) => {
        void (async () => {
          try {
            if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
            // Only this page may save: other sites open in the browser can't post here.
            if (!ORIGIN.test(req.headers.origin ?? ''))
              return send(res, 403, { error: 'Forbidden' });
            if (!req.headers['content-type']?.startsWith('application/json'))
              return send(res, 415, { error: 'Expected JSON' });
            const body: unknown = JSON.parse(await readBody(req, 40 * 1024 * 1024));
            if (!isSaveBody(body)) return send(res, 400, { error: 'Not a town' });

            const dir = await backup();
            // Art first and the map last: the game server restarts when town.json changes.
            await writeFile(join(assets, 'tilesets', 'town.png'), png(body.tileset));
            await writeFile(join(assets, 'sprites', 'town-trees.png'), png(body.trees.png));
            await writeFile(join(assets, 'sprites', 'town-trees.json'), body.trees.json, 'utf8');
            await writeFile(join(assets, 'sprites', 'town-anims.png'), png(body.anims.png));
            await writeFile(join(assets, 'sprites', 'town-anims.json'), body.anims.json, 'utf8');
            await writeFile(join(assets, 'sprites', 'town-map.png'), png(body.picture));
            await writeFile(join(assets, 'maps', 'town.tmx'), body.tmx, 'utf8');
            await writeFile(layoutFile, `${JSON.stringify(body.layout, null, 1)}\n`, 'utf8');
            await writeFile(join(assets, 'maps', 'town.json'), JSON.stringify(body.map), 'utf8');
            server.config.logger.info(`[town builder] saved the town (backup: ${dir})`);
            send(res, 200, { ok: true, backup: dir });
          } catch (err) {
            send(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    },
  };
}

export default defineConfig({
  root,
  // The page only needs its own kit; the game's public folder stays out of it.
  publicDir: false,
  plugins: [townApi()],
  server: { host: '127.0.0.1', port: PORT, strictPort: true, open: true },
});
