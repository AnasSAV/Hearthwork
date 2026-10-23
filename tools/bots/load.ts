/**
 * Bot load test: N signed-in bots join the town, wander with legal client-predicted movement
 * (10 moves/s each, like real clients) and chat now and then. Prints join times, how many moves
 * the server corrected, errors, and message throughput.
 *
 *   npm run load -- --bots 40 --seconds 60 [--url http://localhost:2567] [--cleanup]
 *
 * Bot accounts are created once with the service-role key and their credentials cached in
 * tools/bots/.load-bots.json (gitignored) so repeated runs don't create new users.
 * --cleanup deletes them afterwards. Local or staging projects only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { createClient } from '@supabase/supabase-js';
import {
  ClientMsg,
  collisionGridFromTiled,
  facingFor,
  MOVE_SEND_INTERVAL_MS,
  ServerMsg,
  stepMovement,
  TownState,
  type MoveMessage,
  type TiledMap,
  randomAvatar,
} from '@focus-town/shared';
import townJson from '../../client/public/assets/maps/town.json' with { type: 'json' };
import { serviceClient } from './testPlayers.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const BOTS = Number(arg('bots', '20'));
const SECONDS = Number(arg('seconds', '60'));
const URL_ = arg('url', 'http://localhost:2567');
const CLEANUP = process.argv.includes('--cleanup');
const CACHE = fileURLToPath(new URL('./.load-bots.json', import.meta.url));
const grid = collisionGridFromTiled(townJson as TiledMap);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BotAccount {
  email: string;
  password: string;
  userId: string;
}

async function accounts(n: number): Promise<BotAccount[]> {
  const cached: BotAccount[] = existsSync(CACHE)
    ? (JSON.parse(readFileSync(CACHE, 'utf8')) as BotAccount[])
    : [];
  const admin = serviceClient();
  while (cached.length < n) {
    const i = cached.length;
    const email = `loadbot${i}-${Date.now().toString(36)}@bots.focus.town`;
    const password = `load-${Math.random().toString(36).slice(2)}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    cached.push({ email, password, userId: data.user.id });
    writeFileSync(CACHE, JSON.stringify(cached, null, 2));
  }
  return cached.slice(0, n);
}

async function signIn(acc: BotAccount, index: number): Promise<string> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword(acc);
  if (error || !data.session) throw new Error(`signIn: ${error?.message}`);
  // Profiles must be set up before joining; idempotent.
  await sb.rpc('update_profile', {
    p_username: `loadbot_${index}`,
    p_avatar: randomAvatar(),
  });
  return data.session.access_token;
}

interface BotStats {
  joinMs: number;
  moves: number;
  corrections: number;
  chats: number;
  received: number;
  error: string | null;
}

async function runBot(acc: BotAccount, index: number, until: number): Promise<BotStats> {
  const stats: BotStats = {
    joinMs: 0,
    moves: 0,
    corrections: 0,
    chats: 0,
    received: 0,
    error: null,
  };
  let room: Room<unknown, TownState> | null = null;
  try {
    const token = await signIn(acc, index);
    const client = new Client(URL_);
    client.auth.token = token;
    const t0 = performance.now();
    room = await client.joinOrCreate<TownState>('town', {}, TownState);
    stats.joinMs = Math.round(performance.now() - t0);
    room.onMessage(ServerMsg.MoveCorrect, (m: { x: number; y: number }) => {
      stats.corrections++;
      pos = { ...m };
    });
    room.onMessage(ServerMsg.Chat, () => stats.received++);
    for (const t of ['wallet', 'clock', 'chat:history', 'chat:notice'])
      room.onMessage(t, () => undefined);
    await sleep(300);
    const me = room.state.players.get(room.sessionId);
    let pos = { x: me?.x ?? 384, y: me?.y ?? 415 };
    let dir: MoveMessage['dir'] = 'down';
    let input = { x: 0, y: -1 };
    let nextTurn = 0;
    let nextChat = Date.now() + 5_000 + Math.random() * 20_000;
    while (Date.now() < until) {
      if (Date.now() > nextTurn) {
        input = { x: Math.round(Math.random() * 2 - 1), y: Math.round(Math.random() * 2 - 1) };
        nextTurn = Date.now() + 500 + Math.random() * 2500;
      }
      const next = stepMovement(grid, pos, input, MOVE_SEND_INTERVAL_MS);
      const moving = next.x !== pos.x || next.y !== pos.y;
      if (!moving) nextTurn = 0; // bumped into something: pick a new direction
      pos = next;
      dir = facingFor(input, dir);
      room.send(ClientMsg.Move, { x: pos.x, y: pos.y, dir, moving } satisfies MoveMessage);
      stats.moves++;
      if (Date.now() > nextChat) {
        room.send(ClientMsg.Chat, { text: `bot ${index} says hi` });
        stats.chats++;
        nextChat = Date.now() + 15_000 + Math.random() * 30_000;
      }
      await sleep(MOVE_SEND_INTERVAL_MS);
    }
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
  } finally {
    await room?.leave().catch(() => undefined);
  }
  return stats;
}

const accs = await accounts(BOTS);
console.log(`Starting ${BOTS} bots against ${URL_} for ${SECONDS}s…`);
const until = Date.now() + SECONDS * 1000;
// Stagger joins a little like real arrivals.
const results = await Promise.all(
  accs.map(async (acc, i) => {
    await sleep(i * 100);
    return runBot(acc, i, until);
  }),
);

const ok = results.filter((r) => !r.error);
const joins = ok.map((r) => r.joinMs).sort((a, b) => a - b);
const pct = (p: number) =>
  joins[Math.min(joins.length - 1, Math.floor((p / 100) * joins.length))] ?? 0;
const sum = (k: keyof BotStats) => ok.reduce((s, r) => s + (r[k] as number), 0);
console.table({
  bots: { value: `${ok.length}/${BOTS} ran` },
  'join p50 / p95 (ms)': { value: `${pct(50)} / ${pct(95)}` },
  'moves sent': { value: sum('moves') },
  'moves corrected': {
    value: `${sum('corrections')} (${((100 * sum('corrections')) / Math.max(1, sum('moves'))).toFixed(2)}%)`,
  },
  'chat sent / received': { value: `${sum('chats')} / ${sum('received')}` },
});
for (const r of results.filter((x) => x.error)) console.log(`bot error: ${r.error}`);

if (CLEANUP) {
  const admin = serviceClient();
  for (const acc of accs) await admin.auth.admin.deleteUser(acc.userId);
  writeFileSync(CACHE, '[]');
  console.log(`Deleted ${accs.length} bot accounts.`);
}
process.exitCode = results.some((r) => r.error) ? 1 : 0;
