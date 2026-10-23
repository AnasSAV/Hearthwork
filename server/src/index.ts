import { defineRoom, defineServer, listen } from 'colyseus';
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

const port = Number(process.env.PORT ?? 2567);
await listen(server, port);
log.info('game server listening', { port });
