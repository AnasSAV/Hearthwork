# Hearthwork

(Formerly "Focus Town". Internal names such as the `@focus-town/*` packages, the repo folder and
the local Supabase project id keep the old name on purpose.)

Multiplayer pixel town where verified focus time earns coins for decorating your house.
Full brief: `docs/SPEC.md`. Judgement calls and API deviations: `docs/DECISIONS.md`.

## Stack

- Client: Phaser 4 (game) + React 19 overlays + Vite. Colyseus SDK `@colyseus/sdk` 0.18.
- Server: Colyseus 0.18 (`colyseus`, `@colyseus/schema` v5, `schema()` builder, no decorators), Node 24, run with `tsx`.
- Shared: Zod 4 message schemas, Colyseus state schema, movement/collision, constants.
- DB/Auth: Supabase (Postgres + RLS + SQL functions). Maps: Tiled JSON. Art: LimeZu Modern Interiors/Exteriors (licensed, credit; the derived atlases, built by `tools/art/*.py`, are NOT in this public repo: they live in the private `AnasSAV/Hearthwork-art` repo, are gitignored here, and the deploy copies them in); 16×16 tiles.
- TypeScript 6.0.x (not 7: typescript-eslint doesn't support 7 yet).
- Vite 7.x (not 8: Windows Smart App Control blocks rolldown's native binary on the dev machine).

## Layout

```
client/   src/scenes (WorldScene base → TownScene, HouseScene, GameScene), src/ui (React), src/house (editor),
          src/net (Colyseus/Supabase), public/assets
server/   src/rooms (TownRoom, HouseRoom), src/games (GameRoom, one file per mini-game), src/focus,
          src/db.ts (service-role, server only)
shared/   src/schemas.ts (Zod), src/state.ts (Colyseus schema), src/movement.ts, src/constants.ts,
          src/focus.ts (verified-minute rules), src/games.ts (mini-game rules, coins for playing), src/catalog.ts (items → `npm run seed:items`),
          src/house.ts (canPlace + interior geometry; mirrored by save_layout in SQL)
supabase/ migrations/*.sql, seed.sql
tools/    asset/map generators (bootstrap only; the map JSON/.tmx is the source of truth afterwards,
          except the town and mini-game maps: town-builder/maps/<map>.layout.json are, and the
          Town Builder (`npm run editor`, local only) compiles them into maps/<map>.json and art)
docs/     SPEC.md, DECISIONS.md, SETUP.md (keys), DEPLOY.md
deploy/   pm2 + Caddy configs; render.yaml at the root; .github/workflows (CI, backups, checks)
```

`shared` is consumed as TypeScript source (no build step); Vite and tsx compile it.

## Commands

- `npm install` once at the root (npm workspaces).
- `npm run dev`: server on :2567 + client on :5173.
- `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`.
- `npm run build`: production builds of client and server.
- DB: `supabase start` (Docker) → keys into `server/.env` + `client/.env` (see docs/SETUP.md).
  `npm run test:db` (SQL tests), `npm run smoke` / `npm run e2e:focus` (need `npm run dev`).

## Core rules (never break)

- Server is the only source of truth for time and coins. Clients send intents only
  (`focus:start`, `focus:beat`, `focus:end`, `buy`, `move` …), never durations, coin amounts or prices.
- Every coin change writes a `coin_ledger` row in the same transaction that changes
  `profiles.coins`. Coins only change inside SQL functions.
- Supabase service-role key lives only in `server/.env`. Never import it in client code, never commit it.
  Commit `.env.example` files only.
- Every client→server message is validated with a Zod schema from `shared`. Invalid → reject and log.
- Shared logic (types, schemas, `canPlace()`, movement/collision, constants) lives in `shared/`.
- TypeScript strict everywhere. No `any` unless a comment explains why.
- Game server keeps no important state only in memory/disk (Render free tier restarts at will).

## Conventions

- Commits: small and working, clear messages, authored by AnasSAV only (no co-author trailers).
- Stop after each phase in SPEC.md and wait for the user.
- Note any deviation from the brief in `docs/DECISIONS.md`.
