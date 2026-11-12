import type { Client } from 'colyseus';
import { raftScore, RAFT_BUOY_RADIUS, type PlayerState, type Vec2 } from '@focus-town/shared';
import { inRect, type GameContext, type GameLogic, type Rect } from './logic.js';

export interface RapidsCourse {
  launch: Rect;
  /** Where a raft goes in. */
  start: Vec2;
  finish: Rect;
  buoys: { id: string; x: number; y: number }[];
  /** Back on the bank, after a run. */
  bank: Vec2;
}

/**
 * A time trial down the river. A raft is a player whose moves are checked against the water
 * instead of the land, so rocks and banks are as solid as walls are on foot, and the time and
 * buoys come from positions the server has already accepted.
 */
export class RaftingGame implements GameLogic {
  private runs = new Map<string, { startedAt: number; buoys: Set<string> }>();
  private bests = new Map<string, number>();

  constructor(
    private readonly ctx: GameContext,
    private readonly course: RapidsCourse,
  ) {}

  join(): void {}

  leave(client: Client): void {
    this.runs.delete(client.sessionId);
    this.bests.delete(client.sessionId);
  }

  locked(): boolean {
    return false;
  }

  tick(): void {}

  use(client: Client, player: PlayerState): void {
    if (this.runs.has(client.sessionId)) {
      this.endRun(client, player);
      this.ctx.send(client, { kind: 'raft-bail' });
      return;
    }
    if (!inRect(this.course.launch, player)) {
      this.ctx.send(client, { kind: 'refused', message: 'Walk onto the jetty to launch.' });
      return;
    }
    this.runs.set(client.sessionId, { startedAt: this.ctx.now(), buoys: new Set() });
    player.mode = 'raft';
    player.dir = 'down';
    this.ctx.teleport(client, player, this.course.start);
    this.ctx.played(client);
    this.ctx.send(client, { kind: 'raft-start', buoysLeft: this.course.buoys.length });
  }

  moved(client: Client, player: PlayerState): void {
    const run = this.runs.get(client.sessionId);
    if (!run) return;
    this.ctx.played(client);
    for (const buoy of this.course.buoys) {
      if (run.buoys.has(buoy.id)) continue;
      if (Math.hypot(buoy.x - player.x, buoy.y - player.y) <= RAFT_BUOY_RADIUS) {
        run.buoys.add(buoy.id);
        this.ctx.send(client, { kind: 'raft-buoy', id: buoy.id });
      }
    }
    if (inRect(this.course.finish, player)) {
      const seconds = raftScore(this.ctx.now() - run.startedAt, run.buoys.size);
      const best = seconds < (this.bests.get(client.sessionId) ?? Infinity);
      if (best) this.bests.set(client.sessionId, seconds);
      this.ctx.score(client, 1, `Best ${this.bests.get(client.sessionId)} s`);
      this.ctx.send(client, { kind: 'raft-finish', seconds, buoys: run.buoys.size, best });
      this.endRun(client, player);
    }
  }

  private endRun(client: Client, player: PlayerState): void {
    this.runs.delete(client.sessionId);
    player.mode = '';
    this.ctx.teleport(client, player, this.course.bank);
  }
}
