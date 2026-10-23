import { Client, ServerError, type Room } from '@colyseus/sdk';
import { TownState, type TownJoinOptions } from '@focus-town/shared';
import { uiStore } from '../store';

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567';

export const colyseus = new Client(SERVER_URL);

export type TownRoom = Room<unknown, TownState>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True if the server answers /health within `timeoutMs`. */
async function serverAwake(timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Join the town, retrying with backoff while the server is asleep or restarting
 * (Render's free tier takes ~1 minute to wake). Join rejections from a running server are
 * not retried.
 */
export async function joinTown(options: TownJoinOptions): Promise<TownRoom> {
  let attempt = 0;
  for (;;) {
    uiStore.set({
      connection: attempt === 0 ? { kind: 'connecting' } : { kind: 'waking', attempt },
    });
    // The /health ping wakes a sleeping instance; if it's slow, say so instead of hanging.
    if (!(await serverAwake(attempt === 0 ? 2500 : 8000))) {
      attempt++;
      uiStore.set({ connection: { kind: 'waking', attempt } });
      await sleep(Math.min(1000 * attempt, 5000));
      continue;
    }
    try {
      const room = await colyseus.joinOrCreate('town', options, TownState);
      uiStore.set({ connection: { kind: 'connected' } });
      return room;
    } catch (err) {
      if (err instanceof ServerError) {
        uiStore.set({ connection: { kind: 'error', message: err.message || 'Join rejected' } });
        throw err;
      }
      attempt++;
      await sleep(Math.min(1000 * attempt, 5000));
    }
  }
}
