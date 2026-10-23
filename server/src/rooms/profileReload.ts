import type { MapSchema } from '@colyseus/schema';
import type { Client, Room } from 'colyseus';
import { ClientMsg, emptySchema, encodeAvatar, type PlayerState } from '@focus-town/shared';
import type { AuthedUser } from '../auth.js';
import { db } from '../db.js';
import { log } from '../log.js';
import { onValidated } from './validated.js';

const RELOAD_COOLDOWN_MS = 2_000;

/**
 * The player saved a new name or character (via the `update_profile` SQL function): re-read
 * both from the database, which stays the only source, and update their synced state.
 */
export function registerProfileReload(room: Room, players: () => MapSchema<PlayerState>): void {
  const lastReload = new WeakMap<Client, number>();
  onValidated(room, ClientMsg.ProfileReload, emptySchema, (client) => {
    const now = Date.now();
    if (now - (lastReload.get(client) ?? 0) < RELOAD_COOLDOWN_MS) return;
    lastReload.set(client, now);
    const auth = client.auth as AuthedUser;
    void db()
      .getProfile(auth.userId)
      .then((profile) => {
        const player = players().get(client.sessionId);
        if (!profile?.avatar || !player) return;
        auth.username = profile.username;
        auth.avatar = encodeAvatar(profile.avatar);
        player.name = auth.username;
        player.avatar = auth.avatar;
      })
      .catch((e: unknown) =>
        log.warn('profile reload failed', { userId: auth.userId, error: String(e) }),
      );
  });
}
