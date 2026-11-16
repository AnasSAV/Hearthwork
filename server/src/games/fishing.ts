import type { Client } from 'colyseus';
import {
  facingVector,
  FISH_BITE_MAX_MS,
  FISH_BITE_MIN_MS,
  FISH_HOOK_MS,
  FISH_REEL_MS,
  reelHit,
  rollFish,
  TILE_SIZE,
  type CollisionGrid,
  type Direction,
  type FISH,
  type PlayerState,
  type Vec2,
} from '@focus-town/shared';
import { inRect, type GameContext, type GameLogic, type Rect } from './logic.js';

type Fish = (typeof FISH)[number];

type Cast =
  | { phase: 'waiting'; biteAt: number }
  | { phase: 'bite'; fish: Fish; until: number }
  | { phase: 'reel'; fish: Fish; startedAt: number; zoneStart: number };

/**
 * Cast, wait for a bite, hook it in time, then stop the marker in the zone. The server holds the
 * fish and the clock; the client only ever says "use".
 */
export class FishingGame implements GameLogic {
  private casts = new Map<string, { client: Client; player: PlayerState; cast: Cast }>();

  constructor(
    private readonly ctx: GameContext,
    private readonly zones: Rect[],
    /** Open water, marked solid; without it (an old map) the line goes the way you face. */
    private readonly water: CollisionGrid | null,
  ) {}

  /**
   * Where a line cast from here lands: open water straight ahead if there is some within reach,
   * otherwise the nearest open water to either side or behind (and the player turns to face it).
   */
  private castFrom(player: PlayerState): { dir: Direction; at: Vec2 } | null {
    const ahead = player.dir as Direction;
    if (!this.water) {
      const v = facingVector(ahead);
      return { dir: ahead, at: { x: player.x + v.x * 24, y: player.y - 8 + v.y * 24 } };
    }
    const grid = this.water;
    const isWater = (tx: number, ty: number) =>
      tx >= 0 &&
      ty >= 0 &&
      tx < grid.width &&
      ty < grid.height &&
      grid.solid[ty * grid.width + tx] === 1;
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor((player.y - 1) / TILE_SIZE);
    const order: Direction[] = [
      ahead,
      ...(['left', 'right', 'down', 'up'] as Direction[]).filter((d) => d !== ahead),
    ];
    for (const dir of order) {
      const v = facingVector(dir);
      for (let d = 1; d <= 3; d++) {
        const x = tx + v.x * d;
        const y = ty + v.y * d;
        if (!isWater(x, y)) continue;
        // A tile further out if that's water too, so the float sits in open water.
        const far = isWater(x + v.x, y + v.y) ? 1 : 0;
        return {
          dir,
          at: {
            x: (x + v.x * far) * TILE_SIZE + TILE_SIZE / 2,
            y: (y + v.y * far) * TILE_SIZE + TILE_SIZE / 2,
          },
        };
      }
    }
    return null;
  }

  join(): void {}

  leave(client: Client): void {
    this.casts.delete(client.sessionId);
  }

  locked(sessionId: string): boolean {
    return this.casts.has(sessionId);
  }

  use(client: Client, player: PlayerState): void {
    const entry = this.casts.get(client.sessionId);
    const now = this.ctx.now();
    if (!entry) {
      const cast = this.zones.some((z) => inRect(z, player)) ? this.castFrom(player) : null;
      if (!cast) {
        this.ctx.send(client, { kind: 'refused', message: 'Walk up to the water first.' });
        return;
      }
      player.dir = cast.dir;
      player.castX = cast.at.x;
      player.castY = cast.at.y;
      const wait = FISH_BITE_MIN_MS + this.ctx.random() * (FISH_BITE_MAX_MS - FISH_BITE_MIN_MS);
      this.casts.set(client.sessionId, {
        client,
        player,
        cast: { phase: 'waiting', biteAt: now + wait },
      });
      player.mode = 'cast';
      player.moving = false;
      this.ctx.played(client);
      this.ctx.send(client, { kind: 'cast' });
      return;
    }

    const { cast } = entry;
    if (cast.phase === 'waiting') {
      this.stop(client);
      this.ctx.send(client, { kind: 'cast-cancelled' });
    } else if (cast.phase === 'bite') {
      const zoneStart = 0.05 + this.ctx.random() * (0.9 - cast.fish.zone);
      entry.cast = { phase: 'reel', fish: cast.fish, startedAt: now, zoneStart };
      this.ctx.played(client);
      this.ctx.send(client, {
        kind: 'reel',
        periodMs: cast.fish.periodMs,
        zoneStart,
        zone: cast.fish.zone,
        limitMs: FISH_REEL_MS,
      });
    } else {
      const landed = reelHit(
        now - cast.startedAt,
        cast.fish.periodMs,
        cast.zoneStart,
        cast.fish.zone,
      );
      this.stop(client);
      this.ctx.played(client);
      if (landed) {
        this.ctx.score(client, cast.fish.points);
        this.ctx.send(client, { kind: 'caught', fish: cast.fish.id, points: cast.fish.points });
      } else {
        this.ctx.send(client, { kind: 'escaped', why: 'missed' });
      }
    }
  }

  tick(now: number): void {
    for (const entry of this.casts.values()) {
      const { cast, client } = entry;
      if (cast.phase === 'waiting' && now >= cast.biteAt) {
        entry.cast = {
          phase: 'bite',
          fish: rollFish(this.ctx.random()),
          until: now + FISH_HOOK_MS,
        };
        this.ctx.send(client, { kind: 'bite' });
      } else if (
        (cast.phase === 'bite' && now > cast.until) ||
        (cast.phase === 'reel' && now - cast.startedAt > FISH_REEL_MS)
      ) {
        this.stop(client);
        this.ctx.send(client, { kind: 'escaped', why: 'too-slow' });
      }
    }
  }

  private stop(client: Client): void {
    const entry = this.casts.get(client.sessionId);
    if (entry) entry.player.mode = '';
    this.casts.delete(client.sessionId);
  }
}
