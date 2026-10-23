import { AVATAR_COUNT, nameSchema, type TownJoinOptions } from '@focus-town/shared';

const KEY = 'focus-town:guest';

/**
 * Phase 1 guest identity, kept per tab (sessionStorage) so two tabs are two players.
 * `?name=Alice&avatar=2` in the URL overrides it. Replaced by Supabase profiles in Phase 2.
 */
export function guestIdentity(): TownJoinOptions {
  const params = new URLSearchParams(window.location.search);
  let stored: Partial<TownJoinOptions> = {};
  try {
    stored = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<TownJoinOptions>;
  } catch {
    // Storage unavailable or corrupt: fall through to a fresh identity.
  }

  const nameParam = nameSchema.safeParse(params.get('name') ?? '');
  const name = nameParam.success
    ? nameParam.data
    : (stored.name ?? `Guest-${Math.floor(1000 + Math.random() * 9000)}`);

  const avatarParam = Number(params.get('avatar'));
  const avatar =
    params.has('avatar') &&
    Number.isInteger(avatarParam) &&
    avatarParam >= 0 &&
    avatarParam < AVATAR_COUNT
      ? avatarParam
      : (stored.avatar ?? Math.floor(Math.random() * AVATAR_COUNT));

  const identity = { name, avatar };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Non-fatal: identity just won't survive a reload.
  }
  return identity;
}
