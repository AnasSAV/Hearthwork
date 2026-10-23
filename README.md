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

Sign up, make a character and choose where you'll live: your own home, or move in with a
friend. You start in your yard: walk up into the front door to go inside, and out of the garden
gate (or open the **Map**, **M**) to go to town. In town, sit in a chair at a plaza, café or
park table and press **E** to focus. Spend coins at the Furniture Shop (the hardware store,
north-west): stand at its door and press **E**.
**I** opens your inventory. At home, **Decorate** places furniture inside and garden items in
the yard; **Settings** covers who lives there (invite friends, accept move-in requests),
visitors, the exterior and upgrades. Add friends from **Friends** and visit their homes from
there or the map (you can study at their desks and garden tables too). **Enter** opens chat, **Sounds**
(top right) plays the synced lofi radio and ambience, **Stats** shows your streaks and
**Character** changes your look.

Deploying: see `docs/DEPLOY.md` (Supabase, Render, Cloudflare Pages, Oracle VM, GitHub Actions).
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
| `npm run e2e:house`               | Decorate, visit, study at a friend's desk, go private, upgrade       |
| `npm run load -- --bots 30`       | Load test: signed-in bots walking and chatting                       |
| `npm run check:ledger`            | Verify every balance equals its coin ledger                          |
| `npm run smoke`                   | Two bots join a running server and check sync, speed and wall checks |
| `npm run map:town -- <pack dir>`  | Rebuild the town map and tileset from the LimeZu pack (see SETUP)    |
| `npm run art:characters -- <dir>` | Rebuild the character part atlases from the LimeZu pack              |
| `npm run art:interiors -- <dir>`  | Rebuild furniture and room sprites from the LimeZu pack              |
| `npm run seed:items`              | Regenerate `supabase/seed.sql` from `shared/src/catalog.ts`          |

## Art

Characters, town, houses and furniture are by [LimeZu](https://limezu.itch.io) (Modern Interiors
and Modern Exteriors), used under their license with credit; see `CREDITS.md`. The packs
themselves are not in this repository.
