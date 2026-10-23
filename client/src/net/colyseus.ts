import { Client, MatchMakeError, ServerError, type Room } from '@colyseus/sdk';
import {
  HouseState,
  TownState,
  type HouseJoinOptions,
  type TownJoinOptions,
} from '@focus-town/shared';
import { uiStore } from '../store';
import { currentAccessToken } from './supabase';

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:2567';

export const colyseus = new Client(SERVER_URL);

export type TownRoom = Room<unknown, TownState>;
export type HouseRoom = Room<unknown, HouseState>;

/** The server refused the join (not signed in, not allowed in this house…). Not retried. */
export class JoinRefused extends Error {}

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
 * Join a room, retrying with backoff while the server is asleep or restarting (Render's free
 * tier takes ~1 minute to wake). Refusals from a running server throw JoinRefused.
 */
async function join<S>(
  roomName: string,
  options: object,
  rootSchema: new () => S,
): Promise<Room<unknown, S>> {
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
    // Fresh Supabase access token on every attempt (it auto-refreshes, and expires hourly).
    const token = await currentAccessToken();
    if (!token) {
      uiStore.set({ connection: { kind: 'error', message: 'You are signed out.' } });
      throw new JoinRefused('signed out');
    }
    colyseus.auth.token = token;
    try {
      const room = await colyseus.joinOrCreate<S>(roomName, options, rootSchema);
      uiStore.set({ connection: { kind: 'connected' } });
      return room;
    } catch (err) {
      if (err instanceof ServerError || err instanceof MatchMakeError) {
        throw new JoinRefused(err.message || 'Join refused');
      }
      attempt++;
      await sleep(Math.min(1000 * attempt, 5000));
    }
  }
}

export async function joinTown(options: TownJoinOptions = {}): Promise<TownRoom> {
  try {
    return await join('town', options, TownState);
  } catch (err) {
    if (err instanceof JoinRefused) {
      uiStore.set({ connection: { kind: 'error', message: err.message } });
    }
    throw err;
  }
}

export function joinHouse(options: HouseJoinOptions): Promise<HouseRoom> {
  return join('house', options, HouseState);
}
