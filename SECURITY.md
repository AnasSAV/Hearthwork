# Security

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately to the
maintainer, [@AnasSAV](https://github.com/AnasSAV) (or through GitHub's private vulnerability
reporting, if it is enabled for this repository).

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get
a reply as soon as possible. Please give the maintainer reasonable time to fix the issue
before disclosing it.

Especially welcome are reports of ways to:

- earn, move or spend coins outside the SQL functions, or without a `coin_ledger` row;
- get focus minutes counted without the server verifying them;
- read or change another player's data, home or inventory;
- get the Supabase service-role key or other secrets.

## How secrets are handled

- The Supabase **service-role key** is used only by the game server and lives only in
  `server/.env` (or the host's secret settings). Client code never imports it.
- `.env` files are gitignored; the repository only contains `.env.example` files.
- The browser uses the public anon key with the signed-in user's JWT. Row Level Security and
  `security definer` SQL functions with explicit grants decide what it may read and change.
- Database backups made by GitHub Actions are encrypted before they are stored as workflow
  artifacts.

See the [security model](docs/ARCHITECTURE.md#security-model) for details.
