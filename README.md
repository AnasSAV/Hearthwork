# Focus Town

A cozy multiplayer pixel town where verified focus time earns coins for decorating your house.
See `docs/SPEC.md` for the full brief and `docs/DECISIONS.md` for implementation notes.

## Quick start

Requires Node 22+ (developed on Node 24).

```bash
npm install
supabase start       # local Supabase in Docker; see docs/SETUP.md for keys / hosted setup
npm run dev          # game server on :2567, client on http://localhost:5173
```

Sign up, pick a username and avatar, walk to a desk in the plaza and press **E** to focus.
Use a second browser (or a private window) with another account to see two players.

## Scripts

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                     | Server (tsx watch) + client (Vite) together                          |
| `npm run build`                   | Server bundle (`server/dist`) + client static build (`client/dist`)  |
| `npm run typecheck`               | `tsc` for every workspace and `tools/`                               |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                    |
| `npm test`                        | Vitest unit tests                                                    |
| `npm run test:db`                 | SQL integration tests against local Supabase                         |
| `npm run e2e:focus`               | 6½-minute real focus session through the running server              |
| `npm run smoke`                   | Two bots join a running server and check sync, speed and wall checks |
| `npm run map:town`                | Regenerate the town map (overwrites `town.tmx`/`town.json`)          |
