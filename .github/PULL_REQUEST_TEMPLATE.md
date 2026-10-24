## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran and anything you checked by hand (screenshots welcome for UI changes). -->

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`
- [ ] `npm run test:db` (SQL, catalog or house rules changed)
- [ ] `npm run smoke` / `npm run e2e:house` / `npm run e2e:focus` (rooms, movement, homes or focus changed)

## Core rules

- [ ] Clients still send intents only (no durations, coin amounts or prices)
- [ ] Coins still change only inside SQL functions, with a `coin_ledger` row
- [ ] No secrets or `.env` files committed; the service-role key stays server-only
- [ ] New client messages are validated with a Zod schema from `shared/`
- [ ] Deviations from the spec are noted in `docs/DECISIONS.md`
