# Setup: Supabase, keys and sign-in

Focus Town needs a Supabase project for accounts and coins. You can use a **local** stack
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

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web
   application.
2. Authorized redirect URI:
   - hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
   - local: `http://127.0.0.1:54321/auth/v1/callback`
3. Hosted: Supabase Dashboard → Authentication → Sign In / Providers → Google, paste the client
   ID and secret, enable.
4. Local: put them in `supabase/.env` (gitignored)

   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
   ```

   set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`, then
   `supabase stop && supabase start`.

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

## Rebuilding the art (optional)

The repository already contains everything the game needs. Only to change the art: buy LimeZu's
**Modern Interiors** and **Modern Exteriors** (16×16), unzip them into one folder with
`Interior/` and `Exterior/` inside, install Python 3 and Pillow (`pip install pillow`), then:

```bash
npm run art:characters -- "D:/path/to/FocusTown-art"   # character part atlases + avatarParts.ts
npm run art:interiors -- "D:/path/to/FocusTown-art"    # furniture.png, room.png + interiorSprites.ts
npm run map:town -- "D:/path/to/FocusTown-art"         # town.png, town.json/.tmx, houses atlas
npm run seed:items                                     # if catalog footprints or names changed
```

`map:town` overwrites `town.tmx`; after hand edits in Tiled, export the JSON from Tiled instead.
Never commit the packs themselves (their license forbids redistribution).
