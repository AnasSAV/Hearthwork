import {
  applyBeat,
  completionBonus,
  confirmPresence,
  createTracker,
  DAILY_REWARD_CAP_MIN,
  FOCUS_AWARD_EVERY_MIN,
  FOCUS_MISSED_BEATS_LIMIT,
  isBlockComplete,
  isPresencePaused,
  missedBeats,
  type Beat,
  type BeatOutcome,
  type FocusBlock,
  type FocusEndedMessage,
  type FocusEndReason,
  type FocusStateMessage,
  type FocusTracker,
  type WalletMessage,
} from '@focus-town/shared';
import type { AwardResult, GameDb } from '../db.js';
import { log } from '../log.js';

/** Where a session reports to. Implemented by whichever room the player is in. */
export interface FocusSink {
  /** Colyseus sessionId of the client that owns this focus session. */
  readonly clientSessionId: string;
  state(msg: FocusStateMessage): void;
  wallet(msg: WalletMessage): void;
  ended(msg: FocusEndedMessage): void;
}

export function walletFromAward(r: AwardResult): WalletMessage {
  return {
    coins: r.coins,
    streakDays: r.streakDays,
    totalFocusMin: r.totalFocusMin,
    todayCoinMinutes: r.todayCoinMinutes,
    dailyCapMin: DAILY_REWARD_CAP_MIN,
  };
}

/**
 * One player's focus session. The server clock is the only clock: the client sends beats,
 * the server decides which minutes count and pays them out through `award_focus` in chunks of
 * FOCUS_AWARD_EVERY_MIN, so a crash loses at most a few minutes.
 */
export class FocusSession {
  private tracker: FocusTracker;
  /** Verified minutes not yet written to the database. */
  private unawarded = 0;
  private coinsEarned = 0;
  private bonusPaid = 0;
  private lastMiss: string | null = null;
  private closed = false;
  /** Serializes database calls so awards land in order and before the session ends. */
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: GameDb,
    readonly userId: string,
    readonly sessionId: string,
    readonly deskId: string,
    plannedMin: FocusBlock | null,
    private sink: FocusSink,
    now: number,
  ) {
    this.tracker = createTracker(now, plannedMin);
  }

  static async start(opts: {
    db: GameDb;
    userId: string;
    deskId: string;
    plannedMin: FocusBlock | null;
    sink: FocusSink;
    now: () => number;
  }): Promise<FocusSession> {
    const sessionId = await opts.db.startFocusSession(opts.userId, opts.plannedMin);
    const session = new FocusSession(
      opts.db,
      opts.userId,
      sessionId,
      opts.deskId,
      opts.plannedMin,
      opts.sink,
      opts.now(),
    );
    session.emitState();
    return session;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get verifiedMin(): number {
    return this.tracker.verifiedMin;
  }

  get ownerClientId(): string {
    return this.sink.clientSessionId;
  }

  /** Re-point messages after the owner reconnected (same Colyseus sessionId, new socket). */
  rebind(sink: FocusSink): void {
    this.sink = sink;
  }

  beat(beat: Beat, now: number): BeatOutcome {
    if (this.closed) return { kind: 'ignored', reason: 'too_soon' };
    const { tracker, outcome } = applyBeat(this.tracker, beat, now);
    this.tracker = tracker;
    if (outcome.kind === 'ignored') return outcome;

    this.lastMiss = outcome.kind === 'not_counted' ? outcome.reason : null;
    if (outcome.kind === 'counted') {
      this.unawarded += 1;
      if (this.unawarded >= FOCUS_AWARD_EVERY_MIN) this.flush(0);
    }
    if (isBlockComplete(this.tracker)) {
      this.end('completed');
    } else {
      this.emitState();
    }
    return outcome;
  }

  confirmPresence(): void {
    if (this.closed || !this.tracker.awaitingPresence) return;
    this.tracker = confirmPresence(this.tracker);
    this.lastMiss = null;
    this.emitState();
  }

  /** Called periodically; ends the session after too many missed beats. */
  tick(now: number): void {
    if (!this.closed && missedBeats(this.tracker, now) >= FOCUS_MISSED_BEATS_LIMIT) {
      this.end('missed_beats');
    }
  }

  /**
   * Close the session: pay out remaining minutes and any completion bonus, then mark the row
   * completed or abandoned. Returns once the database work is done.
   */
  end(reason: FocusEndReason): Promise<void> {
    if (this.closed) return this.queue;
    this.closed = true;
    const bonus = completionBonus(this.tracker);
    const voluntaryOpenEnded = reason === 'ended' && this.tracker.plannedMin === null;
    const status = reason === 'completed' || voluntaryOpenEnded ? 'completed' : 'abandoned';

    this.flush(bonus);
    this.enqueue(async () => {
      await this.db.endFocusSession(this.sessionId, status);
    });
    return this.enqueue(async () => {
      this.sink.ended({
        reason,
        verifiedMin: this.tracker.verifiedMin,
        coinsEarned: this.coinsEarned,
        bonus: this.bonusPaid,
      });
      log.info('focus session ended', {
        userId: this.userId,
        sessionId: this.sessionId,
        reason,
        status,
        verifiedMin: this.tracker.verifiedMin,
        coins: this.coinsEarned,
      });
    });
  }

  /** Write unawarded minutes (and a bonus) to the database. */
  private flush(bonus: number): void {
    const minutes = this.unawarded;
    if (minutes === 0 && bonus === 0) return;
    this.unawarded = 0;
    this.enqueue(async () => {
      try {
        const result = await this.db.awardFocus(this.userId, this.sessionId, minutes, bonus);
        this.coinsEarned += result.coinsAwarded;
        this.bonusPaid += result.bonus;
        this.sink.wallet(walletFromAward(result));
        if (!this.closed) this.emitState();
      } catch (err) {
        // Keep the minutes so the next flush retries them (the session is still active).
        if (!this.closed) this.unawarded += minutes;
        log.error('award_focus failed', {
          userId: this.userId,
          sessionId: this.sessionId,
          minutes,
          bonus,
          error: String(err),
        });
      }
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((err: unknown) => {
      log.error('focus session task failed', { sessionId: this.sessionId, error: String(err) });
    });
    return this.queue;
  }

  private emitState(): void {
    this.sink.state({
      sessionId: this.sessionId,
      plannedMin: this.tracker.plannedMin,
      verifiedMin: this.tracker.verifiedMin,
      coinsEarned: this.coinsEarned,
      awaitingPresence: this.tracker.awaitingPresence,
      paused: isPresencePaused(this.tracker),
      lastMiss: this.lastMiss,
    });
  }
}
