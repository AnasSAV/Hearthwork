/**
 * Server clock estimate. Rooms send `clock` on join and every 30 s; synced features (radio,
 * group-table countdowns) use `serverNow()` instead of the local clock, which may be off.
 */
let offset = 0;

export function syncClock(serverNowMs: number): void {
  offset = serverNowMs - Date.now();
}

export function serverNow(): number {
  return Date.now() + offset;
}
