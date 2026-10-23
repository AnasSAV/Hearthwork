# Build brief: Focus Town

You are building **Focus Town**, a browser-based multiplayer pixel world (similar to lofi.town) where people log in, walk around a cozy town, and study or work alongside others. The twist: **verified focus time earns coins**, and coins buy furniture and upgrades for the player's own house, which they can decorate and invite friends into.

Work phase by phase (see "Phases" below). Finish one phase, make sure it runs, tell me how to test it, and **stop and wait for me** before starting the next phase.

## First steps (do these before writing game code)

1. Save this entire brief into the repo as `docs/SPEC.md` so it survives across sessions.
2. Create a short `CLAUDE.md` at the repo root with: the stack, the folder layout, how to run dev, and the non-negotiable rules from the "Core rules" section. Keep it under 60 lines.
3. Check the **current** versions and APIs of Phaser and Colyseus on npm and in their docs before coding. Both changed recently: Phaser 4 shipped in April 2026, and the Colyseus browser SDK package name and callback API have changed between versions. Follow the current official Colyseus + Phaser tutorial, not old blog posts.
4. Use `git` from the start; commit at the end of each working step with a clear message.

## Core rules (never break these)

- **The server is the only source of truth for time and coins.** The client never sends a duration, a coin amount, or a price. It only sends intents (`focus:start`, `focus:beat`, `focus:end`, `buy`, etc.).
- **Every coin change writes a row to `coin_ledger`**, in the same transaction that changes `profiles.coins`. Coins only ever change inside SQL functions.
- **The Supabase service-role key exists only on the game server.** Never import it into client code, never commit it. Use `.env` files and provide `.env.example`.
- **All client→server messages are validated with Zod schemas** from the `shared` package. Reject and log anything invalid.
- **Shared logic lives in `shared/`** (types, message schemas, `canPlace()` for furniture, constants like coin rates) and is used by both client and server.
- TypeScript strict mode everywhere. No `any` unless commented why.

## Stack

| Layer | Choice |
|---|---|
| Game rendering | Phaser 4 (latest 4.x) |
| UI overlays (shop, timer, chat, inventory, HUD) | React + Vite, rendered over the Phaser canvas |
| Realtime multiplayer | Colyseus (Node.js), authoritative server, Schema state sync |
| Auth + database | Supabase (Postgres, Auth with email + Google, Row Level Security) |
| Validation | Zod |
| Maps | Tiled JSON (town map, house interiors), loaded by Phaser |
| Art | Kenney CC0 packs, one consistent tile size (16×16) |
| Monorepo | npm workspaces: `client`, `server`, `shared`, plus `supabase/` for SQL |

Reference project for patterns (sitting on chairs, chat, React overlay on Phaser): SkyOffice on GitHub (MIT, Phaser 3 + Colyseus + React). Borrow ideas, don't fork it, and do not include its WebRTC video chat; this app is camera-free.

## Folder layout

```
focus-town/
  client/              Phaser 4 + React + Vite
    src/scenes/        Boot, Town, House, HouseEdit
    src/ui/            Timer, Shop, Inventory, Chat, HUD (React)
    src/net/           Colyseus client wrapper, Supabase client (anon key only)
    public/assets/     tilesets, sprites, music, maps (Tiled JSON)
  server/              Colyseus + Node
    src/rooms/         TownRoom.ts, HouseRoom.ts
    src/focus/         session tracker, award logic
    src/db.ts          Supabase client with service-role key
  shared/              types, Zod message schemas, canPlace(), constants
  supabase/
    migrations/        *.sql (schema, RLS, functions)
    seed.sql           items catalog, house_levels
  docs/SPEC.md
  CLAUDE.md
```

## Database schema (Supabase / Postgres)

Create these as migrations. Adjust details if needed, but keep the ideas.

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  avatar jsonb not null default '{}',
  coins int not null default 0 check (coins >= 0),
  total_focus_min int not null default 0,
  streak_days int not null default 0,
  last_focus_date date,
  created_at timestamptz default now()
);

create table focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_min int,                 -- 25, 50, or null (open-ended)
  verified_min int not null default 0,
  coins_awarded int not null default 0,
  status text not null default 'active'   -- active | completed | abandoned
);

create table coin_ledger (          -- append-only
  id bigint generated always as identity primary key,
  user_id uuid references profiles not null,
  delta int not null,
  reason text not null,             -- focus | purchase | upgrade | bonus
  ref_id text,
  created_at timestamptz default now()
);

create table items (
  id text primary key,
  name text, category text,         -- furniture | wall | floor | decor | plant
  price int not null,
  footprint_w int default 1, footprint_h int default 1,
  layer text default 'floor',       -- floor | rug | wall | surface
  sprite_key text not null,
  min_house_level int default 1
);

create table inventory (
  user_id uuid references profiles, item_id text references items,
  qty int not null check (qty >= 0),
  primary key (user_id, item_id)
);

create table house_levels (
  level int primary key,
  width int, height int, rooms int,
  cost_coins int, min_total_focus_min int
);

create table houses (
  owner_id uuid primary key references profiles,
  level int not null default 1 references house_levels,
  wallpaper text, floor text, exterior_style text,
  plot_index int unique,
  visibility text default 'friends'  -- public | friends | private
);

create table placed_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references houses,
  item_id text references items,
  room int default 0, x int, y int, rotation int default 0
);

create table friendships (
  user_id uuid references profiles, friend_id uuid references profiles,
  status text default 'pending', primary key (user_id, friend_id)
);
```

**RLS:** enable on every table. Players read their own rows, the `items` and `house_levels` catalogs, and houses they're allowed to visit. Players can never update `coins` or insert into `coin_ledger` directly.

**SQL functions (`security definer`, each locks the profile row with `select ... for update`):**

- `buy_item(item_id text)`: called by the client; checks price, house level and balance; writes ledger row; adds to inventory.
- `upgrade_house()`: called by the client; checks next level's `cost_coins` and `min_total_focus_min`; charges coins; bumps level.
- `save_layout(layout jsonb)`: called by the client; re-validates bounds, overlaps, layers and owned quantities; replaces that house's `placed_items` in one transaction.
- `award_focus(user_id uuid, session_id uuid, minutes int)`: **service role only** (revoke from `anon` and `authenticated`); adds coins + ledger row, updates `total_focus_min`, streak.

A trigger or the signup flow must create the `profiles` row and a level-1 `houses` row with the next free `plot_index`.

## Focus-to-coins economy

Session flow:

1. Player presses E at a desk → React timer opens → picks 25, 50, or open-ended → client sends `focus:start`. Server records start time from its own clock and creates the `focus_sessions` row. Only one active session per user; a new one from another tab/device ends the old one.
2. Client sends `focus:beat` every 60 s with `{ visible: boolean, lastInputAgoSec: number }` (Page Visibility API + keyboard/mouse listeners). Beats arriving faster than every 50 s are ignored.
3. A minute counts as **verified** only if the beat arrived on time, the tab was visible (or the user chose audio-only mode), and there was input in the last 10 minutes. Every 25 minutes show a "still here?" prompt that must be clicked.
4. Every 5 verified minutes the server calls `award_focus`, so coins are saved continuously and a server restart loses at most a few minutes.
5. `focus:end`, disconnect, or 3 missed beats closes the session and pays any completion bonus.

Formula (put constants in `shared/constants.ts` so they're easy to tune):

```
coins = verifiedMinutes × BASE_RATE × (1 + 0.05 × min(streakDays, 10)) + completionBonus
BASE_RATE = 1 coin/min
completionBonus = 5 for a finished 25-min block, 12 for a finished 50-min block
DAILY_REWARD_CAP = 480 minutes (minutes beyond this still count for stats/streak, not coins)
```

Starting prices for `seed.sql`: small decor 40–80, furniture 150–400, wallpaper/floor 200. House level 2 = 1,500 coins + 20 h total focus; level 3 = 5,000 coins + 80 h total focus.

## Housing rules

- Interior is a tile grid sized by `house_levels`: L1 8×6 one room, L2 12×8, L3 12×8 + second room.
- Items have footprint w×h, rotation, and a layer. `rug` sits under `floor` items; `surface` items must sit on a desk/table; `wall` items only on the top wall row.
- Edit mode: React inventory drawer; dragging into Phaser shows a green/red ghost using shared `canPlace()`. Pick-up returns the item to inventory. Nothing is destroyed.
- On upgrade, existing furniture stays where it is; new space is added right/bottom.
- Exterior: the town map in Tiled has numbered plot markers; each house's exterior sprite depends on `level` and `exterior_style`. Walking into a door moves the player from `town` room to that house's room.

## Multiplayer

- Room types: `town` (shared, cap ~50 players per instance, auto-creates new instances) and `house` (one per owner, created on first visitor, disposed when empty).
- `onAuth`: client passes the Supabase JWT in join options; server verifies it and loads the profile. For `house`, also check `visibility` and `friendships`.
- Synced Player state: `id, name, avatar, x, y, dir, status (walking | sitting | focusing | away), focusMin`. Show status and focus minutes above heads.
- Movement: client predicts locally, sends position ≤10×/s; server clamps speed and checks the Tiled collision layer. Other players are smoothed with short tweens.
- Chat: room message, max 200 chars, 1 msg/s per player, profanity filter, report button that stores the message for review.
- Group focus tables: players at the same table share one Pomodoro countdown.
- HUD shows "N people focusing now".
- Synced lofi radio without a streaming server: playlist of license-cleared tracks + durations in a JSON file on the static host; each client computes current track and offset from `(serverNow - radioStartedAt) mod playlistLength`.

## Hosting constraints (design for these)

- Client: static build deployed to **Cloudflare Pages**.
- Database/auth: **Supabase free tier** (500 MB DB, pauses after 1 week of inactivity, no automatic backups).
- Game server: **Render free web service** for prototyping (sleeps after 15 min with no traffic, ~1 min to wake, may restart at any time, filesystem wiped on restart), then **Oracle Cloud Always Free Arm VM** (2 OCPU / 12 GB) for launch with PM2 + Caddy.
- Therefore: the game server must keep **no important state only in memory or on disk**. Everything that matters goes to Postgres promptly. The client must handle reconnects gracefully and show a "waking up server…" message.
- Provide: `render.yaml`, a `Caddyfile` example, a PM2 ecosystem file, a GitHub Actions workflow that pings Supabase daily (prevents pausing) and one that runs a nightly `pg_dump` backup.

## Phases

Stop after each phase, summarize what's done, and give me exact test steps.

### Phase 1 — Walk around together
- Monorepo scaffold, workspaces, shared tsconfig, lint/format, `npm run dev` starts client + server together.
- Small town map in Tiled with a Kenney 16×16 tileset (collision layer + desk objects); include the `.tmx`/`.json` and where the tileset came from in `CREDITS.md`.
- Colyseus `TownRoom`, two browser tabs see each other move with walk animations, camera follow, name tags.
- **Done when:** two tabs on localhost walk around the same town smoothly and collide with walls.

### Phase 2 — Accounts and focus timer
- Supabase migrations, RLS, signup trigger, login screen (email + Google), username/avatar picker.
- JWT verification in `onAuth`.
- Desk interaction → React timer → full focus session flow, `award_focus`, coin counter in HUD, daily cap, streaks.
- Unit tests for the verified-minute logic and the reward formula.
- **Done when:** I can log in, focus for 5 minutes, see coins rise, and the ledger sum equals `profiles.coins`.

### Phase 3 — Shop and inventory
- Seed 30–50 Kenney furniture items with prices.
- Shop building in town → React shop panel → `buy_item`. Inventory drawer.
- **Done when:** buying deducts coins correctly, double-clicking buy can't double-spend, and RLS blocks direct coin edits from the browser console.

### Phase 4 — Houses
- Plot assignment, house exteriors in town, door transition, `HouseRoom`.
- Interior renderer from `houses` + `placed_items`; edit mode with shared `canPlace()`; `save_layout`; `upgrade_house` with level ladder.
- Visiting: visibility setting, friend requests, studying (and earning) inside a friend's house.
- **Done when:** I can decorate, save, reload and see the same layout, upgrade, and a friend can visit.

### Phase 5 — Polish and deploy
- Synced radio, ambient sounds, chat filter/report/mute, stats page, streak calendar.
- Nightly ledger consistency check, bot load test script.
- Deploy configs and a `docs/DEPLOY.md` with step-by-step instructions for Cloudflare Pages, Supabase, Render, and Oracle.

## How to work with me

- If something in this brief is ambiguous or a library API differs from what's described, pick the most sensible option, note it in `docs/DECISIONS.md`, and keep going. Ask me only for things you can't decide (e.g. accounts, keys, art direction choices).
- Never commit secrets. Tell me exactly which keys to put in which `.env` file.
- Prefer small, working increments over large untested changes. Run the build and tests before telling me a phase is done.
- when you commit dont put yourself as co author it should be only me as AnasSAV

Start now with "First steps", then Phase 1.
