/**
 * End-to-end focus test against a live game server + Supabase, in real time (~6.5 minutes):
 * sign in, walk to a desk, focus for 5 verified minutes, check coins rose, the ledger matches
 * and the anti-cheat rules hold (early beats ignored, hidden tab not counted, no walking away).
 *
 *   npm run e2e:focus [-- http://localhost:2567]
 */
import { Client, type Room } from '@colyseus/sdk';
import {
  canStand,
  ClientMsg,
  collisionGridFromTiled,
  ServerMsg,
  TownState,
  type FocusEndedMessage,
  type FocusStateMessage,
  type MoveMessage,
  type TiledMap,
  type WalletMessage,
} from '@focus-town/shared';
import townJson from '../../client/public/assets/maps/town.json' with { type: 'json' };
import { createTestPlayer, deleteTestPlayer, serviceClient } from './testPlayers.js';

const url = process.argv[2] ?? 'http://localhost:2567';
const map = townJson as TiledMap;
const grid = collisionGridFromTiled(map);
const DESK = 'desk-15';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);

function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

/** Resolves with the next message of `type` (or rejects after `timeoutMs`). */
function next<T>(room: Room<unknown, TownState>, type: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = room.onMessage(type, (m: T) => {
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

const player = await createTestPlayer('focusbot', 4);
const client = new Client(url);
client.auth.token = player.token;
const room: Room<unknown, TownState> = await client.joinOrCreate('town', {}, TownState);
const wallets: WalletMessage[] = [];
room.onMessage(ServerMsg.Wallet, (w: WalletMessage) => wallets.push(w));
let corrections = 0;
room.onMessage(ServerMsg.MoveCorrect, () => corrections++);
await sleep(500);
check(wallets[0]?.coins === 0, 'new player starts with 0 coins');

// Starting away from the desk is refused.
const refused = next<{ message: string }>(room, ServerMsg.FocusError);
room.send(ClientMsg.FocusStart, { deskId: DESK, plannedMin: 25, audioOnly: false });
check(/desk/i.test((await refused).message), 'focus:start away from the desk is refused');

// Walk to the desk with legal moves: to the road centre, north into the plaza, then west.
const desk = map.layers
  .flatMap((l) => (l.type === 'objectgroup' ? l.objects : []))
  .find((o) => o.name === DESK)!;
const seat = { x: desk.x + desk.width / 2, y: desk.y + desk.height - 2 };
const me = () => room.state.players.get(room.sessionId)!;
let pos = { x: me().x, y: me().y };
for (const target of [{ x: 384, y: pos.y }, { x: 384, y: seat.y }, seat]) {
  while (Math.hypot(target.x - pos.x, target.y - pos.y) > 0.5) {
    const d = Math.hypot(target.x - pos.x, target.y - pos.y);
    const step = Math.min(7, d);
    const nextPos = {
      x: pos.x + ((target.x - pos.x) / d) * step,
      y: pos.y + ((target.y - pos.y) / d) * step,
    };
    if (!canStand(grid, nextPos.x, nextPos.y))
      throw new Error(`path blocked at ${nextPos.x},${nextPos.y}`);
    pos = nextPos;
    room.send(ClientMsg.Move, { ...pos, dir: 'up', moving: true } satisfies MoveMessage);
    await sleep(110);
  }
}
await sleep(300);
check(corrections === 0 && Math.abs(me().x - seat.x) < 1, `walked to ${DESK} without corrections`);

// Start a 25-minute block.
const firstState = next<FocusStateMessage>(room, ServerMsg.FocusState);
room.send(ClientMsg.FocusStart, { deskId: DESK, plannedMin: 25, audioOnly: false });
const started = await firstState;
await sleep(300);
check(
  started.verifiedMin === 0 && me().status === 'focusing',
  'session started, player is focusing',
);

// Walking away while focusing is refused. (Starting already sent one correction: the snap
// onto the chair.)
const correctionsBefore = corrections;
room.send(ClientMsg.Move, {
  x: me().x + 6,
  y: me().y,
  dir: 'left',
  moving: true,
} satisfies MoveMessage);
await sleep(400);
check(
  corrections === correctionsBefore + 1 && me().x === seat.x,
  'moving while seated is corrected',
);

// A beat after 5 s is ignored (no state update).
await sleep(5_000);
room.send(ClientMsg.FocusBeat, { visible: true, lastInputAgoSec: 1 });
let early = false;
await next(room, ServerMsg.FocusState, 1_500).then(
  () => (early = true),
  () => undefined,
);
check(!early, 'beat after 5 s is ignored');

// Five on-time beats, one per minute.
const startedAt = Date.now() - 5_500;
let state: FocusStateMessage = started;
for (let minute = 1; minute <= 5; minute++) {
  await sleep(startedAt + minute * 61_000 - Date.now());
  const pending = next<FocusStateMessage>(room, ServerMsg.FocusState, 10_000);
  room.send(ClientMsg.FocusBeat, { visible: true, lastInputAgoSec: 3 });
  state = await pending;
  log(`beat ${minute}: verified ${state.verifiedMin} min, +${state.coinsEarned} coins`);
}
await sleep(1_500); // the 5-minute award is written asynchronously
check(state.verifiedMin === 5, '5 minutes verified');
const wallet = wallets.at(-1)!;
check(wallet.coins > 0, `coins rose to ${wallet.coins} after 5 minutes`);
check(me().focusMin === 5, 'focus minutes shown above the head');

// A hidden-tab beat doesn't count.
await sleep(startedAt + 6 * 61_000 - Date.now());
const hidden = next<FocusStateMessage>(room, ServerMsg.FocusState, 10_000);
room.send(ClientMsg.FocusBeat, { visible: false, lastInputAgoSec: 3 });
const afterHidden = await hidden;
check(
  afterHidden.verifiedMin === 5 && afterHidden.lastMiss === 'hidden',
  'hidden-tab minute not counted',
);

// End the session.
const endedP = next<FocusEndedMessage>(room, ServerMsg.FocusEnded, 10_000);
room.send(ClientMsg.FocusEnd);
const ended = await endedP;
check(
  ended.verifiedMin === 5 && ended.coinsEarned === wallet.coins,
  `session ended: ${JSON.stringify(ended)}`,
);

// Database invariants.
const svc = serviceClient();
const { data: profile } = await svc
  .from('profiles')
  .select('coins, total_focus_min, streak_days')
  .eq('id', player.userId)
  .single();
const { data: ledger } = await svc.from('coin_ledger').select('delta').eq('user_id', player.userId);
const ledgerSum = (ledger ?? []).reduce((s, r: { delta: number }) => s + r.delta, 0);
check(
  profile?.coins === ledgerSum,
  `profiles.coins (${profile?.coins}) equals ledger sum (${ledgerSum})`,
);
check(
  profile?.total_focus_min === 5 && profile.streak_days === 1,
  'total minutes and streak saved',
);
const { data: sessions } = await svc
  .from('focus_sessions')
  .select('status, verified_min, coins_awarded')
  .eq('user_id', player.userId);
check(
  sessions?.length === 1 && sessions[0]!.status === 'abandoned' && sessions[0]!.verified_min === 5,
  `session row closed: ${JSON.stringify(sessions)}`,
);
const { data: mismatches } = await svc.rpc('ledger_mismatches');
check(Array.isArray(mismatches) && mismatches.length === 0, 'no ledger mismatches anywhere');

await room.leave();
await deleteTestPlayer(player);
console.log(process.exitCode ? 'FOCUS E2E FAILED' : 'FOCUS E2E PASSED');
process.exit();
