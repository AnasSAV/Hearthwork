import type { Client } from 'colyseus';
import {
  FISH_BITE_MAX_MS,
  FISH_BITE_MIN_MS,
  FISH_HOOK_MS,
  FISH_REEL_MS,
  reelHit,
  rollFish,
  type FISH,
  type PlayerState,
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
  ) {}

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
      if (!this.zones.some((z) => inRect(z, player))) {
        this.ctx.send(client, { kind: 'refused', message: 'Walk up to the water first.' });
        return;
      }
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
