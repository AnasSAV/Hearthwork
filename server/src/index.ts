import { defineRoom, defineServer, listen } from 'colyseus';
import { config } from './config.js';
import { db } from './db.js';
import { startFocusTicker } from './focus/registry.js';
import { log } from './log.js';
import { TownRoom } from './rooms/TownRoom.js';

const startedAt = Date.now();

export const server = defineServer({
  rooms: {
    town: defineRoom(TownRoom),
  },
  express: (app) => {
    // Cheap endpoint the client pings to wake a sleeping Render instance.
    app.get('/health', (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    });
  },
});

// Fail fast on missing configuration instead of at the first join.
void config.supabaseUrl;
void config.supabaseServiceKey;

// Trackers from a previous process are gone; close their database rows. Minutes already
// awarded are kept, at most FOCUS_AWARD_EVERY_MIN unsaved minutes per session are lost.
try {
  const abandoned = await db().abandonActiveSessions();
  if (abandoned > 0) log.info('closed focus sessions left over from last run', { abandoned });
} catch (err) {
  log.error('could not close leftover focus sessions (is Supabase reachable?)', {
    error: String(err),
  });
}
startFocusTicker();

await listen(server, config.port);
log.info('game server listening', { port: config.port });
