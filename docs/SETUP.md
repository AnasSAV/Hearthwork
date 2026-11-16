# Setup: Supabase, keys and sign-in

Hearthwork needs a Supabase project for accounts and coins. You can use a **local** stack
(Docker, best for development) or a **hosted** free-tier project (needed for deployment).

## Which key goes where

| File          | Variable                    | Value                                                         | Secret?              |
| ------------- | --------------------------- | ------------------------------------------------------------- | -------------------- |
| `server/.env` | `SUPABASE_URL`              | Project URL                                                   | no                   |
| `server/.env` | `SUPABASE_SERVICE_ROLE_KEY` | **Secret key** (`sb_secret_…`) or legacy `service_role` key   | **YES**: server only |
| `client/.env` | `VITE_SUPABASE_URL`         | Project URL                                                   | no                   |
| `client/.env` | `VITE_SUPABASE_ANON_KEY`    | **Publishable key** (`sb_publishable_…`) or legacy `anon` key | no (public)          |
| `client/.env` | `VITE_SERVER_URL`           | Game server URL, e.g. `http://localhost:2567`                 | no                   |

Never put the secret/service-role key in `client/.env`: everything in `client/.env` ships to
browsers. Both `.env` files are gitignored; only the `.env.example` files are committed.

## Option A: local Supabase (Docker)

Requires Docker Desktop running and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
On Windows, if `npm i -g supabase` can't run its install script, download
`supabase_windows_amd64.tar.gz` from https://github.com/supabase/cli/releases and put
`supabase.exe` on your PATH.

```bash
supabase start          # first run downloads the images (a few GB)
supabase status         # prints the URL and keys
```

Put the printed values in the two `.env` files:

```
# server/.env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY from supabase status>

# client/.env
VITE_SERVER_URL=http://localhost:2567
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY from supabase status>
```

`supabase start` applies `supabase/migrations/*.sql` and `supabase/seed.sql`. After changing
migrations run `supabase db reset` (wipes local data). Studio (database UI) is at
http://127.0.0.1:54323 unless you started with `-x studio`. Local email sign-up needs no
confirmation.

## Option B: hosted Supabase (free tier)

1. Create a project at https://supabase.com/dashboard.
2. **Run the schema.** Either:
   - SQL editor: paste and run each file in `supabase/migrations/` in name order, then
     `supabase/seed.sql`, **or**
   - CLI: `supabase login`, `supabase link --project-ref <ref>`, `supabase db push`.
3. **Keys:** Project Settings → API Keys. Copy the project URL, the publishable key and a secret
   key into the `.env` files as in the table above.
4. **Auth URLs:** Authentication → URL Configuration. Set Site URL to your client URL
   (`http://localhost:5173` while developing) and add it to Redirect URLs.
5. Email sign-ups need confirmation by default (Authentication → Sign In / Providers → Email).
   Keep it on for production; you can turn it off while testing.

## Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com) → Google Auth Platform:
   - **Branding:** app name `Hearthwork`, your support email, authorized domains
     `anas-hussaindeen.com` and `supabase.co`.
   - **Audience:** External, then **Publish app** (only the basic `email` and `profile` scopes are
     used, so Google doesn't need to review it).
   - **Clients → Create client → Web application:**
     - Authorized JavaScript origins: `https://hearthwork.anas-hussaindeen.com`,
       `http://localhost:5173`
     - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`,
       `http://127.0.0.1:54321/auth/v1/callback`
2. **Local:** put the client ID and secret in `supabase/.env` (git-ignored). The variables
   override `supabase/config.toml`, which keeps Google off so CI and fresh clones start without
   credentials:

   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=GOCSPX-...
   ```

   then `supabase stop && supabase start`. `curl localhost:54321/auth/v1/settings` should show
   `"google": true`.

3. **Hosted:** see [DEPLOY.md](DEPLOY.md).

Google players go through the same character and home screens as everyone else; the username
field is pre-filled from their Google name (`suggestUsername()` in `shared/src/username.ts`). If
they cancel at Google, the sign-in screen says so.

## Checking the economy

The ledger invariant (`profiles.coins` = sum of that player's `coin_ledger.delta`) can be checked
any time in the SQL editor:

```sql
select * from public.ledger_mismatches();   -- must return no rows

select p.username, p.coins, coalesce(sum(l.delta), 0) as ledger_sum
from public.profiles p left join public.coin_ledger l on l.user_id = p.id
group by p.id order by p.coins desc;
```

## Tests that need the database

```bash
npm run test:db      # SQL integration tests (signup, RLS, award_focus, cap, streaks)
npm run smoke        # two bots: auth, movement sync, anti-teleport (needs npm run dev)
npm run e2e:focus    # ~6.5 min real-time focus session, checks coins + ledger (needs npm run dev)
```

They read `server/.env` and `client/.env`, and create and delete their own throwaway accounts.
Only run them against local or staging projects.

## Editing the town and game maps (optional)

`npm run editor` opens the **Town Builder** at http://127.0.0.1:5180. It only runs on your
machine (it is never built or deployed). The picker at the top switches between the town and the
four mini-game maps (Mirror Lake, Rushwater Rapids, Butterfly Meadow, Treasure Cove). Every map
is made of pieces you drag around, like a base builder:

- **Drag** a piece from the tray at the bottom onto the town: buildings, study tables, trees and
  flowers, benches and lamps, fish for the ponds, and the arrival point. **Click** a piece in
  the tray instead to keep it in hand and place several (Esc or right click to stop).
- Green means it fits; red means it doesn't (it would sit on another piece, on water, or off the
  map), and a note says why. Each piece only claims its footprint, so tree tops and roofs can
  overlap things behind them.
- **Drag** a placed piece to move it; arrow keys nudge it. The panel on the right renames a
  building's sign, duplicates (D) or removes (Del) the piece. Drag empty ground to look around;
  the mouse wheel zooms.
- **Ground**: paint grass, paving, water, sand, sea or pier planks with a 1–8 tile brush;
  Shift+drag fills a box. Water and sand get proper edges by themselves.
- **Mini-game maps** need a few things the builder checks before saving; the rest is worked out
  from the map:
  - Mirror Lake: players fish from any bank or pier edge next to water.
  - Rushwater Rapids: place the **Raft launch** beside the river and the **Finish line**
    downriver (Special). Rafts go in at the open water nearest the launch, rocks in the water
    are obstacles, and **Bonus buoys** take 2 seconds off. It warns if the river is blocked.
  - Butterfly Meadow: butterflies gather at the flower beds.
  - Treasure Cove: treasure is buried somewhere on the sand.
  - Every game map has an arrival point and can have a **Place name** sign.
- **Town size** adds or removes land on any side. Ctrl+Z / Ctrl+Y undo and redo; unsaved work
  survives a reload.
- **Save town** (Ctrl+S) first checks the town works: there must be a Furniture Shop whose door
  can be reached and an arrival point on open ground; it also warns about seats nobody can
  reach. Then it writes the layout (`tools/town-builder/maps/<map>.layout.json`) and
  everything the game loads: `maps/<map>.json` + `.tmx` and `tilesets/<map>.png`, plus the tree
  and animation sheets and world-map picture for the town, or the shared `sprites/games.*` for a
  game map. The previous versions are kept in `tools/town-builder/backups/` (last
  20, not committed).

With `npm run dev` running, the game server restarts by itself when you save; reload the game
to see the change. Commit the layouts in `tools/town-builder/maps/` and the changed files under
`client/public/assets` when you're happy with it.

The pieces come from `tools/art/build_town_kit.py` (`npm run art:town-kit -- <pack dir>`), which
cuts them from the LimeZu pack. To add a piece, add a line there and rebuild the kit.

## Rebuilding the art (optional)

The repository already contains everything the game needs. Only to change the art: buy LimeZu's
**Modern Interiors** and **Modern Exteriors** (16×16), unzip them into one folder with
`Interior/` and `Exterior/` inside, install Python 3 and Pillow (`pip install pillow`), then:

```bash
npm run art:characters -- "D:/path/to/FocusTown-art"   # character part atlases + avatarParts.ts
npm run art:interiors -- "D:/path/to/FocusTown-art"    # furniture.png, room.png + interiorSprites.ts
npm run map:town -- "D:/path/to/FocusTown-art"         # town.png, town.json/.tmx, houses atlas
npm run art:ui -- "D:/path/to/FocusTown-art"           # emote / timer / typing bubbles
npm run seed:items                                     # if catalog footprints or names changed
```

`map:town` is the original town generator. The Town Builder owns the town now, so rebuilding
with it is rarely what you want: the builder's next save replaces its output again. To change
what the builder offers, rebuild its kit (`npm run art:town-kit -- <pack dir>`); add
`--starter` only to reset the layout to the generated town.
Never commit the packs themselves (their license forbids redistribution).
