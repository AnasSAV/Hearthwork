# Deploying Hearthwork

Three pieces, deployed separately:

| Piece                  | Where                                                                 | Notes                                                              |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Database + auth        | **Supabase** (free tier)                                              | Pauses after 7 days idle; no automatic backups (we add both fixes) |
| Game server (Colyseus) | **Render** free web service (later optionally an **Oracle Cloud** VM) | One process; all state is in Postgres                              |
| Client (static)        | **Cloudflare Pages**, published by GitHub Actions                     | Vite build of `client/`                                            |

Order: Supabase → game server → client (the client needs both URLs at build time) → GitHub
Actions secrets.

### Production today

| What        | Where                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Game        | https://hearthwork.anas-hussaindeen.com (Pages project `hearthwork`)     |
| Game server | https://focus-town-server.onrender.com (Render, Singapore)               |
| Supabase    | project `wtjmotlodqhkzfercxro` (Seoul, `ap-northeast-2`)                 |
| Deploys     | push to `main`: Render rebuilds the server, `deploy-client.yml` the site |

---

## 1. Supabase

### 1.1 Create the project

1. https://supabase.com/dashboard → **New project**. Pick the region closest to your players,
   and save the database password somewhere safe.
2. **Project Settings → API Keys**: note the **Project URL**, the **publishable key**
   (`sb_publishable_…`) and a **secret key** (`sb_secret_…`). Legacy `anon` / `service_role`
   keys also work.
3. Recommended: **Project Settings → JWT Keys → migrate to asymmetric signing keys**. The game
   server then verifies player tokens locally (faster) instead of asking the Auth server on every
   join.

### 1.2 Create the schema

With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push --include-seed      # runs supabase/migrations/*.sql, then supabase/seed.sql
```

Without the CLI: **SQL editor** → run each file in `supabase/migrations/` in name order, then
`supabase/seed.sql`.

### 1.3 Auth settings

The production auth settings live in `supabase/config.toml` under `[remotes.production]` (site
URL, redirect URLs, email confirmation, Google). Google's client ID and secret come from
`supabase/.env` (git-ignored, see SETUP.md). Apply them with:

```bash
supabase config push --project-ref <your-project-ref>
```

It shows a diff per service and asks before pushing each one: answer **y** for auth and **n** for
anything you didn't mean to change (e.g. storage).

Email: Supabase's built-in mailer only delivers to your project's team members and is heavily
rate-limited, so confirmation is **off** for now (players can sign in straight away). Before a
wider launch, configure **custom SMTP** (Authentication → Emails → SMTP; e.g. Resend or Brevo
free tiers, sending from your domain) and set `enable_confirmations = true` in the
`[remotes.production.auth.email]` block.

### 1.4 Connection string for backups

**Connect** (top bar) → **Session pooler** → copy the URI (IPv4, port 5432) and fill in your
password. GitHub's runners can't reach the IPv6-only direct connection, so use the pooler one.

---

## 2. Game server on Render (prototype)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → choose the repo. Render reads `render.yaml`
   (free web service, `npm ci --include=dev && npm run build -w @focus-town/server`, health check
   `/health`). Change `region` there first if Singapore isn't closest to you.
3. Set the two secret env vars when prompted:
   - `SUPABASE_URL` = project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = **secret** key. Only ever here, never in the client.
4. Deploy. Check `https://<service>.onrender.com/health` returns `{"ok":true,…}`.

Free-tier behaviour: the service sleeps after 15 minutes without traffic and takes about a
minute to wake. The client pings `/health` and shows "Waking up server…" meanwhile. Restarts are
fine: focus minutes are saved every 5 minutes, and leftover sessions are closed on boot.

---

## 3. Client on Cloudflare Pages

The site is published by `.github/workflows/deploy-client.yml` on every push to `main` that
touches the client (or by hand: Actions → Deploy client → Run workflow). It builds with the
repository **variables** and uploads with Wrangler.

One-time setup:

1. Cloudflare → My Profile → API Tokens → Custom token with **Account · Cloudflare Pages · Edit**
   (and, for the first setup only, **Zone · DNS · Edit** on your domain).
2. Create the project and a first deployment:

   ```bash
   export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
   npx wrangler pages project create hearthwork --production-branch main
   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... VITE_SERVER_URL=...      npm run build -w @focus-town/client
   npx wrangler pages deploy client/dist --project-name hearthwork --branch main
   ```

3. Custom domain: Pages project → **Custom domains** → add `hearthwork.<your-domain>`. With the
   domain on Cloudflare, add a proxied `CNAME hearthwork → hearthwork.pages.dev`; the certificate
   is issued within a few minutes.
4. Repository **variables** (public values, baked into the bundle): `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` (publishable key), `VITE_SERVER_URL`. Repository **secrets**:
   `CLOUDFLARE_API_TOKEN` (Pages-only token), `CLOUDFLARE_ACCOUNT_ID`.
5. Put the site URL into Supabase's site/redirect URLs (step 1.3) and Google's authorized
   JavaScript origins.

`client/public/_headers` sets basic security headers and caching.

---

## 4. Game server on Oracle Cloud (optional, no sleeping)

Always Free Ampere A1: up to 4 OCPU / 24 GB in total; 2 OCPU / 12 GB is plenty here.

### 4.1 Create the VM

1. Compute → Instances → **Create instance**. Image: **Ubuntu 24.04**, shape **VM.Standard.A1.Flex**
   (2 OCPU, 12 GB). Add your SSH public key. Create.
2. Networking → the instance's VCN → **Security List** → add ingress rules for TCP **80** and
   **443** from `0.0.0.0/0`.
3. SSH in (`ssh ubuntu@<public-ip>`) and open the same ports in Ubuntu's firewall (Oracle's
   images ship strict iptables rules):

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

### 4.2 Install and build

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2

git clone https://github.com/<you>/focus-town.git && cd focus-town
npm ci --include=dev
npm run build -w @focus-town/server

cat > server/.env <<'EOF'
PORT=2567
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret key>
EOF
chmod 600 server/.env

pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints, so the server starts on boot
curl localhost:2567/health
```

Keep it to **one** PM2 instance (fork mode). Focus sessions are tracked in-process.

### 4.3 HTTPS with Caddy

1. DNS: an **A record** `game.<your-domain>` → the VM's public IP. If the domain is on
   Cloudflare, leave the record **DNS only** (grey cloud) so Caddy can get its certificate.
2. Install Caddy (official repo):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```
3. `sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile`, replace `game.example.com` with your
   domain, then `sudo systemctl reload caddy`. WebSockets are proxied automatically.
4. Check `https://game.<your-domain>/health`, set Cloudflare Pages' `VITE_SERVER_URL` to
   `https://game.<your-domain>` and redeploy the client. You can then delete the Render service.

### 4.4 Updating

```bash
cd focus-town && git pull
npm ci --include=dev && npm run build -w @focus-town/server
pm2 reload focus-town
```

Run new migrations with `supabase db push` from your machine first if there are any.

---

## 5. GitHub Actions (keep-alive, backups, ledger check, CI)

Repo → Settings → Secrets and variables → **Actions** → New repository secret:

| Secret                      | Value                                                        | Used by                  |
| --------------------------- | ------------------------------------------------------------ | ------------------------ |
| `SUPABASE_URL`              | project URL                                                  | keep-alive, ledger check |
| `SUPABASE_ANON_KEY`         | publishable key                                              | keep-alive               |
| `SUPABASE_SERVICE_ROLE_KEY` | secret key                                                   | ledger check             |
| `SUPABASE_DB_URL`           | Session pooler URI with password (step 1.4)                  | backups                  |
| `BACKUP_PASSPHRASE`         | a long random passphrase, also kept in your password manager | backups                  |
| `CLOUDFLARE_API_TOKEN`      | Pages-only API token (step 3)                                | client deploy            |
| `CLOUDFLARE_ACCOUNT_ID`     | your Cloudflare account ID                                   | client deploy            |

Workflows (`.github/workflows/`):

- **deploy-client.yml**: on pushes to `main` that touch the client, builds and publishes it to
  Cloudflare Pages.
- **ci.yml**: on every push/PR runs typecheck, lint, format, unit tests and build, plus the SQL
  integration tests against a throwaway local Supabase stack.
- **supabase-keepalive.yml**: daily read so the free project never pauses.
- **db-backup.yml**: nightly `supabase db dump` (roles, schema, auth data, public data),
  encrypted with GPG, kept as an artifact for 30 days.
- **ledger-check.yml**: nightly; fails (GitHub emails you) if any balance differs from its
  ledger.

Run each once by hand (Actions → workflow → Run workflow) to check the secrets.

GitHub turns off scheduled workflows in a repo with no commits for 60 days. If that happens,
re-enable them in the Actions tab; while they're off, the keep-alive isn't running either.

### Restoring a backup

```bash
# Download the artifact from the workflow run, then:
gpg --decrypt focus-town-YYYY-MM-DD.tgz.gpg > backup.tgz && tar xzf backup.tgz
# Into a NEW, empty Supabase project (Session pooler URI):
psql "$NEW_DB_URL" --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file auth_data.sql --file data.sql
```

Then point the server's and client's env vars at the new project.

---

## 6. Checklist

- [ ] Supabase: schema pushed with seed, Site URL and redirects set, email delivery decided
- [ ] Render (or Oracle): `/health` OK, `SUPABASE_SERVICE_ROLE_KEY` set **only** here
- [ ] Cloudflare Pages: three `VITE_*` vars set, site loads, sign-up works
- [ ] GitHub secrets added; keep-alive, backup and ledger workflows run green once
- [ ] Two accounts can see each other in town, focus earns coins, the shop works
