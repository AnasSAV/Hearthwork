import type { Client } from 'colyseus';
import {
  bearingTo,
  canStand,
  DIG_COOLDOWN_MS,
  heatAt,
  rollTreasure,
  TREASURE_COMPASS_AFTER,
  TREASURE_FIND_RADIUS,
  treasureScore,
  type CollisionGrid,
  type PlayerState,
  type Vec2,
} from '@focus-town/shared';
import { inRect, type GameContext, type GameLogic, type Rect } from './logic.js';

/**
 * Each player has their own buried treasure, known only to the server. Every hole answers with
 * how warm it is; a few holes in, it gives a compass bearing as well.
 */
export class TreasureGame implements GameLogic {
  private hunts = new Map<string, { target: Vec2; digs: number; dugAt: number }>();

  constructor(
    private readonly ctx: GameContext,
    private readonly zone: Rect,
    private readonly grid: CollisionGrid,
  ) {}

  join(client: Client): void {
    this.hunts.set(client.sessionId, { target: this.bury(), digs: 0, dugAt: -Infinity });
  }

  leave(client: Client): void {
    this.hunts.delete(client.sessionId);
  }

  locked(): boolean {
    return false;
  }

  tick(): void {}

  use(client: Client, player: PlayerState): void {
    const hunt = this.hunts.get(client.sessionId);
    const now = this.ctx.now();
    if (!hunt || now - hunt.dugAt < DIG_COOLDOWN_MS) return;
    if (!inRect(this.zone, player)) {
      this.ctx.send(client, { kind: 'refused', message: 'Dig further up the beach.' });
      return;
    }
    hunt.dugAt = now;
    hunt.digs += 1;
    this.ctx.played(client);
    const here = { x: player.x, y: player.y };
    const distance = Math.hypot(hunt.target.x - here.x, hunt.target.y - here.y);
    if (distance <= TREASURE_FIND_RADIUS) {
      const treasure = rollTreasure(this.ctx.random());
      const points = treasureScore(treasure.points, hunt.digs);
      this.ctx.score(client, points);
      this.ctx.send(client, {
        kind: 'found',
        ...here,
        treasure: treasure.id,
        points,
        digs: hunt.digs,
      });
      hunt.target = this.bury();
      hunt.digs = 0;
      return;
    }
    this.ctx.send(client, {
      kind: 'dug',
      ...here,
      heat: heatAt(distance),
      bearing: hunt.digs >= TREASURE_COMPASS_AFTER ? bearingTo(here, hunt.target) : null,
      digs: hunt.digs,
    });
  }

  /** Somewhere on the sand a player can actually stand. */
  private bury(): Vec2 {
    for (let i = 0; i < 40; i++) {
      const p = {
        x: this.zone.x + this.ctx.random() * this.zone.width,
        y: this.zone.y + this.ctx.random() * this.zone.height,
      };
      if (canStand(this.grid, p.x, p.y)) return p;
    }
    return { x: this.zone.x + this.zone.width / 2, y: this.zone.y + this.zone.height / 2 };
  }
}
