import type { MapSchema } from '@colyseus/schema';
import type { Client } from 'colyseus';
import {
  BUTTERFLY_COUNT,
  BUTTERFLY_KINDS,
  BUTTERFLY_RESPAWN_MS,
  CritterState,
  facingVector,
  NET_COOLDOWN_MS,
  NET_RADIUS,
  NET_REACH,
  rollButterfly,
  type ButterflyKind,
  type PlayerState,
  type Vec2,
} from '@focus-town/shared';
import type { GameContext, GameLogic, Rect } from './logic.js';

interface Flight {
  target: Vec2;
  speed: number;
  /** When it picks somewhere new to go. */
  turnAt: number;
}

const SPEEDS = new Map(BUTTERFLY_KINDS.map((k) => [k.id as ButterflyKind, k]));

/**
 * The server flies every butterfly and decides what a swing catches, so all players chase the
 * same ones and a catch can't be claimed from the client.
 */
export class ButterflyGame implements GameLogic {
  private flights = new Map<string, Flight>();
  private respawns: number[] = [];
  private swungAt = new Map<string, number>();
  private nextId = 1;
  private lastTick = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly critters: () => MapSchema<CritterState>,
    private readonly bounds: Rect,
    private readonly flowers: Vec2[],
  ) {}

  join(): void {
    if (this.critters().size === 0) {
      for (let i = 0; i < BUTTERFLY_COUNT; i++) this.spawn(this.ctx.now());
    }
  }

  leave(client: Client): void {
    this.swungAt.delete(client.sessionId);
  }

  locked(): boolean {
    return false;
  }

  use(client: Client, player: PlayerState): void {
    const now = this.ctx.now();
    if (now - (this.swungAt.get(client.sessionId) ?? -Infinity) < NET_COOLDOWN_MS) return;
    this.swungAt.set(client.sessionId, now);
    this.ctx.played(client);

    const ahead = facingVector(player.dir);
    const net = { x: player.x + ahead.x * NET_REACH, y: player.y - 8 + ahead.y * NET_REACH };
    const caught: { kind: ButterflyKind; points: number }[] = [];
    for (const [id, c] of [...this.critters().entries()]) {
      if (Math.hypot(c.x - net.x, c.y - net.y) > NET_RADIUS) continue;
      const kind = SPEEDS.get(c.kind as ButterflyKind);
      if (!kind) continue;
      caught.push({ kind: kind.id, points: kind.points });
      this.critters().delete(id);
      this.flights.delete(id);
      this.respawns.push(now + BUTTERFLY_RESPAWN_MS);
    }
    const points = caught.reduce((sum, c) => sum + c.points, 0);
    if (points > 0) this.ctx.score(client, points);
    this.ctx.send(client, { kind: 'net', caught });
  }

  tick(now: number): void {
    const dt = Math.min(500, now - this.lastTick) / 1000;
    this.lastTick = now;
    this.respawns = this.respawns.filter((at) => {
      if (at > now) return true;
      this.spawn(now);
      return false;
    });
    for (const [id, c] of this.critters().entries()) {
      const flight = this.flights.get(id);
      if (!flight) continue;
      const dx = flight.target.x - c.x;
      const dy = flight.target.y - c.y;
      const left = Math.hypot(dx, dy);
      if (left < 4 || now >= flight.turnAt) {
        flight.target = this.somewhere();
        flight.turnAt = now + 1_500 + this.ctx.random() * 3_500;
        continue;
      }
      // A little flutter across the line of travel.
      const step = Math.min(left, flight.speed * dt);
      const flutter = Math.sin(now / 130 + c.x) * 6 * dt;
      c.x = this.clampX(c.x + (dx / left) * step - (dy / left) * flutter);
      c.y = this.clampY(c.y + (dy / left) * step + (dx / left) * flutter);
    }
  }

  private spawn(now: number): void {
    const kind = rollButterfly(this.ctx.random());
    const at = this.somewhere();
    const c = new CritterState();
    c.kind = kind.id;
    c.x = at.x;
    c.y = at.y;
    const id = `b${this.nextId++}`;
    this.critters().set(id, c);
    this.flights.set(id, { target: this.somewhere(), speed: kind.speed, turnAt: now + 2_000 });
  }

  /** Mostly a flower bed; sometimes anywhere in the meadow. */
  private somewhere(): Vec2 {
    const flower = this.flowers[Math.floor(this.ctx.random() * this.flowers.length)];
    if (flower && this.ctx.random() < 0.8) return { x: flower.x, y: flower.y };
    return {
      x: this.bounds.x + this.ctx.random() * this.bounds.width,
      y: this.bounds.y + this.ctx.random() * this.bounds.height,
    };
  }

  private clampX(x: number): number {
    return Math.max(this.bounds.x, Math.min(this.bounds.x + this.bounds.width, x));
  }

  private clampY(y: number): number {
    return Math.max(this.bounds.y, Math.min(this.bounds.y + this.bounds.height, y));
  }
}
