/**
 * End-to-end houses test against a running server + LOCAL Supabase (uses `docker exec` to grant
 * test coins/focus time, so never point it at a real project):
 * decorate → save → reload, friends-only visiting, studying at a friend's desk, going private,
 * upgrading, and the house showing up on a town lot.
 *
 *   npm run e2e:house [-- http://localhost:2567]
 */
import { execFileSync } from 'node:child_process';
import { Client, type Room } from '@colyseus/sdk';
import {
  canStand,
  ClientMsg,
  houseCollisionGrid,
  HouseState,
  houseWorld,
  ServerMsg,
  TownState,
  type FocusStateMessage,
  type HouseNoticeMessage,
  type MoveMessage,
} from '@focus-town/shared';
import { createTestPlayer, deleteTestPlayer, type TestPlayer } from './testPlayers.js';

const url = process.argv[2] ?? 'http://localhost:2567';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) =>
  execFileSync(
    'docker',
    ['exec', 'supabase_db_focus-town', 'psql', '-U', 'postgres', '-tA', '-c', q],
    {
      encoding: 'utf8',
    },
  ).trim();

function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

function next<T>(room: Room<unknown, HouseState>, type: string, timeoutMs = 5_000): Promise<T> {
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

function grant(p: TestPlayer, coins: number, focusMin = 0) {
  sql(`with l as (insert into public.coin_ledger (user_id, delta, reason, ref_id)
         values ('${p.userId}', ${coins}, 'bonus', 'test-grant') returning delta)
       update public.profiles set coins = coins + (select delta from l),
         total_focus_min = total_focus_min + ${focusMin} where id = '${p.userId}'`);
}

async function joinHouse(p: TestPlayer, ownerId: string): Promise<Room<unknown, HouseState>> {
  const client = new Client(url);
  client.auth.token = p.token;
  return client.joinOrCreate('house', { ownerId }, HouseState);
}

const owner = await createTestPlayer('owner', 1);
const friend = await createTestPlayer('friend', 3);

// --- Owner buys a desk, a rug and a painting, and lays out the house ------------------------
grant(owner, 1000);
for (const item of ['desk_study', 'rug_amber', 'painting_meadow']) {
  const r = await owner.client.rpc('buy_item', {
    p_item_id: item,
    p_request_id: crypto.randomUUID(),
  });
  check(!r.error, `owner bought ${item}`);
}
const layout = {
  wallpaper: null,
  floor: null,
  items: [
    { item_id: 'desk_study', room: 0, x: 1, y: 2, rotation: 0 },
    { item_id: 'rug_amber', room: 0, x: 4, y: 3, rotation: 0 },
    { item_id: 'painting_meadow', room: 0, x: 2, y: 0, rotation: 0 },
  ],
};
check(!(await owner.client.rpc('save_layout', { p_layout: layout })).error, 'owner saved a layout');

const ownerRoom = await joinHouse(owner, owner.userId);
await sleep(400);
check(ownerRoom.state.items.length === 3, 'house room shows the saved layout (3 items)');
check(ownerRoom.state.width === 8 && ownerRoom.state.level === 1, 'level-1 house is 8×6');

// --- Strangers can't get into a friends-only house ------------------------------------------
let refused = '';
try {
  await joinHouse(friend, owner.userId);
} catch (err) {
  refused = String(err);
}
check(/friends/i.test(refused), `non-friend refused: ${refused.slice(0, 60)}`);

// --- Become friends, then visit -----------------------------------------------------------------
await friend.client.rpc('send_friend_request', { p_username: owner.username });
await owner.client.rpc('respond_friend_request', { p_from: friend.userId, p_accept: true });
const friendRoom = await joinHouse(friend, owner.userId);
await sleep(400);
check(friendRoom.roomId === ownerRoom.roomId, 'friend joined the same house room');
check(friendRoom.state.players.size === 2, 'both are in the house');

// --- Friend walks to the desk and starts focusing -------------------------------------------
const dims = { width: 8, height: 6, rooms: 1 };
const grid = houseCollisionGrid(
  dims,
  layout.items.map((i) => ({ ...i, itemId: i.item_id })),
);
const o = houseWorld.roomOrigin(dims, 0);
const seat = { x: (o.x + 1) * 16 + 8, y: (o.y + 3) * 16 + 14 };
const me = () => friendRoom.state.players.get(friendRoom.sessionId)!;
let pos = { x: me().x, y: me().y };
for (const target of [{ x: pos.x, y: seat.y }, seat]) {
  while (Math.hypot(target.x - pos.x, target.y - pos.y) > 0.5) {
    const d = Math.hypot(target.x - pos.x, target.y - pos.y);
    const step = Math.min(7, d);
    const n = {
      x: pos.x + ((target.x - pos.x) / d) * step,
      y: pos.y + ((target.y - pos.y) / d) * step,
    };
    if (!canStand(grid, n.x, n.y)) throw new Error(`blocked at ${n.x},${n.y}`);
    pos = n;
    friendRoom.send(ClientMsg.Move, { ...pos, dir: 'up', moving: true } satisfies MoveMessage);
    await sleep(110);
  }
}
await sleep(300);
const focusP = next<FocusStateMessage>(friendRoom, ServerMsg.FocusState);
// Seat ids are "<placed item id>:<column>"; the desk is the only study spot.
const deskItem = friendRoom.state.items.find((i) => i.itemId === 'desk_study')!;
friendRoom.send(ClientMsg.FocusStart, {
  deskId: `${deskItem.id}:0`,
  plannedMin: 25,
  audioOnly: false,
});
const focus = await focusP;
await sleep(300);
check(
  focus.verifiedMin === 0 && me().status === 'focusing',
  "friend is focusing at the owner's desk",
);
check(
  ownerRoom.state.players.get(friendRoom.sessionId)?.status === 'focusing',
  'owner sees the friend focusing',
);

// --- Owner goes private: the visitor is told to leave ---------------------------------------
const notice = next<HouseNoticeMessage>(friendRoom, ServerMsg.HouseNotice);
await owner.client.rpc('update_house_settings', {
  p_visibility: 'private',
  p_exterior_style: 'brick',
});
ownerRoom.send(ClientMsg.HouseReload);
const n = await notice;
check(n.leave && /closed/.test(n.message), `visitor told to leave: "${n.message}"`);
await friendRoom.leave();

// --- Upgrade: needs 20 h focus + 1,500 coins; furniture stays put ----------------------------
grant(owner, 1500, 20 * 60);
const up = await owner.client.rpc('upgrade_house');
check(!up.error && (up.data as { level: number }).level === 2, 'owner upgraded to level 2');
ownerRoom.send(ClientMsg.HouseReload);
await sleep(600);
check(ownerRoom.state.width === 12 && ownerRoom.state.height === 8, 'house grew to 12×8');
check(ownerRoom.state.items.length === 3, 'furniture kept after the upgrade');
await ownerRoom.leave();

// --- The house shows on its town lot (if it got one of the first plots) ----------------------
const plot = Number(sql(`select plot_index from public.houses where owner_id = '${owner.userId}'`));
const townClient = new Client(url);
townClient.auth.token = owner.token;
const town: Room<unknown, TownState> = await townClient.joinOrCreate(
  'town',
  { fromPlot: plot },
  TownState,
);
await sleep(800);
if (plot < 6) {
  const lot = town.state.lots.get(String(plot));
  check(
    lot?.ownerId === owner.userId && lot.level === 2 && lot.style === 'brick',
    `house drawn on lot ${plot}`,
  );
  const p = town.state.players.get(town.sessionId)!;
  check(p.y > 31 * 16 && p.y < 32 * 16, 'spawned on the doorstep after leaving the house');
} else {
  console.log(`SKIP  plot ${plot} is beyond the 6 town lots`);
}
await town.leave();

await deleteTestPlayer(owner);
await deleteTestPlayer(friend);
console.log(process.exitCode ? 'HOUSE E2E FAILED' : 'HOUSE E2E PASSED');
process.exit();
