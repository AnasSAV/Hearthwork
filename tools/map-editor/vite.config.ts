import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The town editor: a local-only page (127.0.0.1:5180) that edits the game's town map in place.
 * It is never built or deployed; `npm run editor` serves it with the game's public assets and a
 * small dev-only API that reads and writes the map files.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = fileURLToPath(new URL('../../client/public', import.meta.url));
const maps = join(publicDir, 'assets', 'maps');
const backups = join(root, 'backups');
const PORT = 5180;
const ORIGIN = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`);
const KEEP_BACKUPS = 30;

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
  map: { width: number; height: number; layers: unknown[]; tilesets: unknown[] };
  tmx: string;
  picture: string;
}

function isSaveBody(b: unknown): b is SaveBody {
  const m = (b as SaveBody | null)?.map;
  return (
    typeof b === 'object' &&
    b !== null &&
    typeof m === 'object' &&
    Number.isInteger(m.width) &&
    Number.isInteger(m.height) &&
    Array.isArray(m.layers) &&
    Array.isArray(m.tilesets) &&
    typeof (b as SaveBody).tmx === 'string' &&
    (b as SaveBody).tmx.startsWith('<?xml') &&
    typeof (b as SaveBody).picture === 'string' &&
    (b as SaveBody).picture.startsWith('data:image/png;base64,')
  );
}

function mapApi(): Plugin {
  return {
    name: 'focus-town:map-api',
    configureServer(server) {
      server.middlewares.use('/api/map', (req, res) => {
        void (async () => {
          try {
            if (req.method === 'GET') {
              res.setHeader('cache-control', 'no-store');
              res.setHeader('content-type', 'application/json');
              res.end(await readFile(join(maps, 'town.json')));
              return;
            }
            if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
            // Only this page may save: other sites open in the browser can't post here.
            if (!ORIGIN.test(req.headers.origin ?? ''))
              return send(res, 403, { error: 'Forbidden' });
            if (!req.headers['content-type']?.startsWith('application/json'))
              return send(res, 415, { error: 'Expected JSON' });
            const body: unknown = JSON.parse(await readBody(req, 30 * 1024 * 1024));
            if (!isSaveBody(body)) return send(res, 400, { error: 'Not a map' });

            // Keep the previous version, then write the picture and .tmx first and the .json
            // last (the game server restarts when the .json changes).
            await mkdir(backups, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backup = join(backups, `town-${stamp}.json`);
            await copyFile(join(maps, 'town.json'), backup);
            const old = (await readdir(backups)).filter((f) => f.endsWith('.json')).sort();
            for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS)))
              await unlink(join(backups, f));

            const png = Buffer.from(body.picture.slice('data:image/png;base64,'.length), 'base64');
            await writeFile(join(publicDir, 'assets', 'sprites', 'town-map.png'), png);
            await writeFile(join(maps, 'town.tmx'), body.tmx, 'utf8');
            await writeFile(join(maps, 'town.json'), JSON.stringify(body.map), 'utf8');
            server.config.logger.info(`[editor] saved town map (backup: ${backup})`);
            send(res, 200, { ok: true, backup });
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
  publicDir,
  plugins: [mapApi()],
  server: { host: '127.0.0.1', port: PORT, strictPort: true, open: true },
});
