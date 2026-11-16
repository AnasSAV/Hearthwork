# Contributing

Thanks for helping with Hearthwork. This guide covers the setup, the checks every change must
pass, and the rules the game depends on.

## Setup

Follow [Getting started](README.md#getting-started) in the README and
[docs/SETUP.md](docs/SETUP.md). You need Node 22+ (24 recommended), Docker and the Supabase CLI.

```bash
npm install
supabase start
npm run dev
```

## Workflow

1. Branch from `main` (`feature/…`, `fix/…`).
2. Keep commits small and working, with messages that say what changed and why.
3. Run the checks below before pushing.
4. Open a pull request and fill in the template. CI must be green.

## Checks

| Command                                      | When                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `npm run typecheck`                          | Always                                                            |
| `npm run lint`                               | Always                                                            |
| `npm run format` (or `npm run format:check`) | Always                                                            |
| `npm test`                                   | Always                                                            |
| `npm run build`                              | Always                                                            |
| `npm run test:db`                            | You touched SQL, the catalog or house rules                       |
| `npm run smoke`, `npm run e2e:house`         | You touched rooms, movement, chat or homes (needs `npm run dev`)  |
| `npm run e2e:focus`                          | You touched focus sessions or the economy (takes about 7 minutes) |

CI runs the first five plus the database tests on every push and pull request.

## Rules every change must keep

These protect the economy and players' trust. A change that breaks one won't be merged.

- **The server owns time and coins.** Clients send intents (`focus:start`, `focus:beat`,
  `move`, `buy`, …), never durations, coin amounts or prices.
- **Coins only change inside SQL functions**, and every change writes a `coin_ledger` row in the
  same transaction that updates `profiles.coins`.
- **The service-role key stays on the server.** Never import it into client code and never
  commit a `.env` file; update the `.env.example` files instead.
- **Validate every client message** with a Zod schema from `shared/`; reject and log invalid
  ones.
- **Shared logic lives in `shared/`**: types, schemas, `canPlace()`, movement and collision,
  constants. Client and server import the same code.
- **TypeScript strict everywhere.** No `any` unless a comment explains why.
- **No important state only in server memory.** The host may restart at any time.

## Common tasks

- **Database changes:** add a new file in `supabase/migrations/` (don't edit one that has
  already been applied), add tests in `supabase/tests/`, and run `npm run test:db`.
- **New shop items:** edit `shared/src/catalog.ts`, then `npm run seed:items` to regenerate
  `supabase/seed.sql`. If placement rules change, keep `canPlace()` in `shared/src/house.ts`
  and `save_layout` in SQL in step.
- **Town layout:** use the town editor (`npm run editor`) and commit `town.json`, `town.tmx`
  (the map's images go to the private art repository).
- **Art:** neither the LimeZu packs nor images derived from them may be committed here (the
  paths are gitignored); they live in the private art repository. See
  [docs/SETUP.md](docs/SETUP.md#getting-the-art).
- **Decisions:** if a change departs from [docs/SPEC.md](docs/SPEC.md) or makes a judgement
  call, add a short note to [docs/DECISIONS.md](docs/DECISIONS.md).

## Code style

Prettier and ESLint settle formatting and most style questions. Beyond that: match the
surrounding code, prefer small pure functions in `shared/` for rules that need tests, and
write comments that explain why, not what.

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.
