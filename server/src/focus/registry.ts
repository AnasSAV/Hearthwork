import type { FocusSession } from './FocusSession.js';

/**
 * Active focus sessions in this process, keyed by user id. Enforces one session per user
 * across rooms and tabs (the database enforces it too, via a partial unique index).
 * Assumes a single game-server process, which matches the Render / single-VM deployment.
 */
const sessions = new Map<string, FocusSession>();

export const focusRegistry = {
  /** The user's open session, if any (closed sessions are dropped on sight). */
  get(userId: string): FocusSession | undefined {
    const session = sessions.get(userId);
    if (session?.isClosed) {
      sessions.delete(userId);
      return undefined;
    }
    return session;
  },
  set(session: FocusSession): void {
    sessions.set(session.userId, session);
  },
  count(): number {
    let open = 0;
    for (const s of sessions.values()) if (!s.isClosed) open++;
    return open;
  },
  /** End sessions whose beats stopped. Called on a timer. */
  tick(now: number): void {
    for (const session of sessions.values()) {
      session.tick(now);
      if (session.isClosed) sessions.delete(session.userId);
    }
  },
};

let ticker: NodeJS.Timeout | null = null;

export function startFocusTicker(): void {
  ticker ??= setInterval(() => focusRegistry.tick(Date.now()), 5_000);
  ticker.unref();
}
