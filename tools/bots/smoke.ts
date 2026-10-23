/**
 * Multiplayer smoke test: two bots join the town, one walks, the other must see it; then the
 * walker tries a teleport and a wall walk-through, which the server must reject.
 *
 * Creates two throwaway accounts (see testPlayers.ts) and deletes them afterwards.
 * Run against a live server: npm run smoke [-- http://localhost:2567]
 */
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import {
  canStand,
  ClientMsg,
  collisionGridFromTiled,
  ServerMsg,
  TownState,
  type ChatMessage,
  type WhisperMessage,
  type MoveCorrectMessage,
  type MoveMessage,
  type PlayerState,
  type TiledMap,
  encodeAvatar,
} from '@focus-town/shared';
import townJson from '../../client/public/assets/maps/town.json' with { type: 'json' };
import { createTestPlayer, deleteTestPlayer } from './testPlayers.js';

const url = process.argv[2] ?? 'http://localhost:2567';
const grid = collisionGridFromTiled(townJson as TiledMap);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

// Joining without a Supabase token must be refused.
let anonymousRejected = false;
try {
  await new Client(url).joinOrCreate('town', {}, TownState);
} catch {
  anonymousRejected = true;
}
check(anonymousRejected, 'joining without signing in is rejected');

const walkerPlayer = await createTestPlayer('walker');
const watcherPlayer = await createTestPlayer('watcher');
async function join(token: string): Promise<Room<unknown, TownState>> {
  const client = new Client(url);
  client.auth.token = token;
  return client.joinOrCreate('town', {}, TownState);
}
const walker = await join(walkerPlayer.token);
const watcher = await join(watcherPlayer.token);
check(walker.roomId === watcher.roomId, 'both bots share one town instance');

await sleep(300);
check(watcher.state.players.size >= 2, `watcher sees ${watcher.state.players.size} players`);

const corrections: MoveCorrectMessage[] = [];
walker.onMessage(ServerMsg.MoveCorrect, (m: MoveCorrectMessage) => corrections.push(m));

let seenMoves = 0;
Callbacks.get(watcher).onAdd('players', (p: PlayerState, id: string) => {
  if (id !== walker.sessionId) return;
  Callbacks.get(watcher).onChange(p, () => seenMoves++);
});

// 0. Whispers: private to the two players, and only while they stand close together.
const bystanderPlayer = await createTestPlayer('bystander');
const bystander = await join(bystanderPlayer.token);
await sleep(300);
const whispersTo = {
  walker: [] as WhisperMessage[],
  watcher: [] as WhisperMessage[],
  bystander: [] as WhisperMessage[],
};
walker.onMessage(ServerMsg.Whisper, (m: WhisperMessage) => whispersTo.walker.push(m));
watcher.onMessage(ServerMsg.Whisper, (m: WhisperMessage) => whispersTo.watcher.push(m));
bystander.onMessage(ServerMsg.Whisper, (m: WhisperMessage) => whispersTo.bystander.push(m));
// Everyone spawned within a few pixels of each other, so they're in whisper range.
walker.send(ClientMsg.Whisper, { to: watcher.sessionId, text: 'psst, just between us' });
await sleep(400);
check(
  whispersTo.watcher.length === 1 && whispersTo.watcher[0]!.text === 'psst, just between us',
  'whisper delivered to the recipient',
);
check(whispersTo.walker.length === 1, 'sender gets their own whisper back');
check(whispersTo.bystander.length === 0, 'a bystander does not see the whisper');
await bystander.leave();
await deleteTestPlayer(bystanderPlayer);
await sleep(1100); // chat rate limit

// 0b. A new character is read back from the database, not taken from the client.
const look = { v: 2, body: 4, eyes: 2, outfit: 20, hair: 33, acc: 5 } as const;
await walkerPlayer.client.rpc('update_profile', {
  p_username: walkerPlayer.username,
  p_avatar: look,
});
walker.send(ClientMsg.ProfileReload, { avatar: 'forged' });
await sleep(300);
const walkerSeen = () => watcher.state.players.get(walker.sessionId)!;
check(walkerSeen().avatar !== encodeAvatar(look), 'profile:reload with a payload is rejected');
walker.send(ClientMsg.ProfileReload);
await sleep(500);
check(
  walkerSeen().avatar === encodeAvatar(look),
  `watcher sees the new character (${walkerSeen().avatar})`,
);

// 1. Walk along the open road at legal speed.
const me = walker.state.players.get(walker.sessionId)!;
let x = me.x;
const y = me.y;
for (let i = 0; i < 10; i++) {
  const nx = x + 8; // 8px per 100ms = 80px/s
  if (!canStand(grid, nx, y)) break;
  x = nx;
  const msg: MoveMessage = { x, y, dir: 'right', moving: true };
  walker.send(ClientMsg.Move, msg);
  await sleep(110);
}
await sleep(300);
const seen = watcher.state.players.get(walker.sessionId)!;
check(Math.abs(seen.x - x) < 0.01, `watcher sees walker at x=${seen.x} (expected ${x})`);
check(seenMoves > 0, `watcher received ${seenMoves} position updates`);
check(corrections.length === 0, 'legal walk produced no corrections');

// 2. Teleport attempt.
walker.send(ClientMsg.Move, { x: x + 200, y, dir: 'right', moving: true } satisfies MoveMessage);
await sleep(300);
check(corrections.length === 1, 'teleport rejected with a correction');
check(Math.abs(seen.x - x) < 0.01, 'teleport did not change server position');

// 3. Step into the nearest solid tile in reach.
let target: { x: number; y: number } | null = null;
for (let dy = -40; dy <= 40 && !target; dy += 2) {
  for (let dx = -40; dx <= 40; dx += 2) {
    if (!canStand(grid, x + dx, y + dy)) {
      target = { x: x + dx, y: y + dy };
      break;
    }
  }
}
if (target) {
  await sleep(600);
  walker.send(ClientMsg.Move, { ...target, dir: 'up', moving: true } satisfies MoveMessage);
  await sleep(300);
  check(corrections.length === 2, `walking into a wall at (${target.x}, ${target.y}) rejected`);
} else {
  console.log('SKIP  no solid tile within reach of the walker');
}

// 4. Invalid payload is ignored, connection survives.
walker.send(ClientMsg.Move, { x: 'nope', y: Infinity });
walker.send('not-a-real-message', { hi: 1 });
await sleep(300);
check(walker.connection.isOpen, 'connection survives invalid payloads');

// 4b. Now ~80px apart: too far to whisper.
const farNotices: string[] = [];
const offFar = walker.onMessage(ServerMsg.ChatNotice, (n: { message: string }) =>
  farNotices.push(n.message),
);
walker.send(ClientMsg.Whisper, { to: watcher.sessionId, text: 'can you hear me?' });
await sleep(400);
offFar();
check(
  whispersTo.watcher.length === 1 && farNotices.some((n) => /walk closer/i.test(n)),
  'whisper refused once the players are far apart',
);
await sleep(1100);

// 5. Chat: delivered to the room, profanity masked, one message per second.
const heard: ChatMessage[] = [];
watcher.onMessage(ServerMsg.Chat, (m: ChatMessage) => heard.push(m));
const notices: string[] = [];
walker.onMessage(ServerMsg.ChatNotice, (n: { message: string }) => notices.push(n.message));
walker.send(ClientMsg.Chat, { text: 'what the fuck is this' });
walker.send(ClientMsg.Chat, { text: 'second message too soon' });
await sleep(500);
check(
  heard.length === 1 && heard[0]!.text === 'what the **** is this',
  `chat filtered: "${heard[0]?.text}"`,
);
check(
  notices.some((n) => /slow down/i.test(n)),
  'second message within a second is refused',
);

await walker.leave();
await watcher.leave();
await deleteTestPlayer(walkerPlayer);
await deleteTestPlayer(watcherPlayer);
console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
process.exit();
