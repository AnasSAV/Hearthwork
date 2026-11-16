import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The town builder: a local-only page (127.0.0.1:5180) for laying out the town and the
 * mini-game maps. It is never built or deployed. `npm run editor` serves it with a small
 * dev-only API that reads a map's layout and, on save, writes the layout plus the files the
 * game loads.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const assets = fileURLToPath(new URL('../../client/public/assets', import.meta.url));
const layouts = join(root, 'maps');
const backups = join(root, 'backups');
const PORT = 5180;
const ORIGIN = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`);
const KEEP_BACKUPS = 20;
const MAP_IDS = ['town', 'lake', 'rapids', 'meadow', 'cove'] as const;
type MapId = (typeof MAP_IDS)[number];

/** Everything a save of each map may write, relative to client/public/assets. */
function outputsOf(map: MapId): string[] {
  const own = [`maps/${map}.json`, `maps/${map}.tmx`, `tilesets/${map}.png`];
  return map === 'town'
    ? [
        ...own,
        'sprites/town-trees.png',
        'sprites/town-trees.json',
        'sprites/town-anims.png',
        'sprites/town-anims.json',
        'sprites/town-map.png',
      ]
    : [...own, 'sprites/games.png', 'sprites/games.json'];
}

const isMapId = (m: unknown): m is MapId => MAP_IDS.includes(m as MapId);

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
  map: MapId;
  layout: { width: number; height: number; ground: string[]; pieces: unknown[] };
  files: Record<string, string>;
}

const PNG = 'data:image/png;base64,';

/** A well-formed save that only writes this map's own files. */
function checkSave(b: unknown): string | null {
  const s = b as SaveBody | null;
  if (typeof s !== 'object' || s === null || !isMapId(s.map)) return 'Unknown map';
  if (!Number.isInteger(s.layout?.width) || !Array.isArray(s.layout?.ground)) return 'Not a layout';
  if (typeof s.files !== 'object' || s.files === null) return 'No files';
  const allowed = new Set(outputsOf(s.map));
  for (const [path, content] of Object.entries(s.files)) {
    if (!allowed.has(path)) return `Not allowed to write ${path}`;
    if (typeof content !== 'string') return `Bad content for ${path}`;
    if (path.endsWith('.png') && !content.startsWith(PNG)) return `${path} is not a PNG`;
  }
  if (!s.files[`maps/${s.map}.json`]) return 'No map';
  return null;
}

async function backup(map: MapId): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(backups, `${stamp}-${map}`);
  await mkdir(dir, { recursive: true });
  for (const rel of outputsOf(map)) {
    await copyFile(join(assets, rel), join(dir, rel.replace('/', '__'))).catch(() => undefined);
  }
  await copyFile(join(layouts, `${map}.layout.json`), join(dir, `${map}.layout.json`)).catch(
    () => undefined,
  );
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
          const map = new URL(req.url ?? '', 'http://x').searchParams.get('map') ?? 'town';
          if (!isMapId(map)) return send(res, 400, { error: 'Unknown map' });
          try {
            res.setHeader('cache-control', 'no-store');
            res.setHeader('content-type', 'application/json');
            res.end(await readFile(join(layouts, `${map}.layout.json`)));
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
            const body: unknown = JSON.parse(await readBody(req, 60 * 1024 * 1024));
            const problem = checkSave(body);
            if (problem) return send(res, 400, { error: problem });
            const { map, layout, files } = body as SaveBody;

            const dir = await backup(map);
            // Art first and the map last: the game server restarts when a map's JSON changes.
            const mapFile = `maps/${map}.json`;
            for (const [path, content] of Object.entries(files)) {
              if (path === mapFile) continue;
              await writeFile(
                join(assets, path),
                path.endsWith('.png') ? Buffer.from(content.slice(PNG.length), 'base64') : content,
              );
            }
            await mkdir(layouts, { recursive: true });
            await writeFile(
              join(layouts, `${map}.layout.json`),
              `${JSON.stringify(layout, null, 1)}\n`,
              'utf8',
            );
            await writeFile(join(assets, mapFile), files[mapFile]!, 'utf8');
            server.config.logger.info(`[town builder] saved ${map} (backup: ${dir})`);
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
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    open: true,
    // Saves write layouts and backups inside this folder; watching them only reloads the page
    // (and on Windows can crash the watcher while a backup is being written).
    watch: { ignored: ['**/backups/**', '**/maps/**'] },
  },
});
