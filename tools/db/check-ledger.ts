/**
 * Ledger consistency check: every player's `profiles.coins` must equal the sum of their
 * `coin_ledger` rows. Exits 1 (and prints the offenders) if any don't, so a nightly CI job
 * fails loudly. Uses the service-role key; run locally or from GitHub Actions:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tools/db/check-ledger.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb.rpc('ledger_mismatches');
if (error) {
  console.error(`ledger_mismatches failed: ${error.message}`);
  process.exit(2);
}
const rows = data as { user_id: string; coins: number; ledger_sum: number }[];
const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });

// exitCode (not process.exit) lets open HTTP sockets close cleanly first.
if (rows.length === 0) {
  console.log(`Ledger OK: ${count ?? '?'} profiles, every balance matches its ledger.`);
} else {
  console.error(`LEDGER MISMATCH for ${rows.length} player(s):`);
  console.table(rows);
  process.exitCode = 1;
}
