import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const url = process.env.SUPABASE_URL;
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
export const dbConfigured = Boolean(url && serviceKey && anonKey);

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_focus-town';

/** Run SQL as the postgres superuser inside the local DB container (test setup only). */
export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

export function serviceClient(): SupabaseClient {
  return createClient(url!, serviceKey!, { auth: { persistSession: false } });
}

/** Sign up a fresh player; returns their signed-in client and id. */
export async function signUpPlayer(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@focus.town`;
  const { data, error } = await client.auth.signUp({ email, password: 'correct-horse-42' });
  if (error || !data.user) throw new Error(`signUp failed: ${error?.message}`);
  return { client, userId: data.user.id };
}

/**
 * Give a test player coins the way a real award would: balance and a matching ledger row in
 * one statement, so the ledger invariant still holds.
 */
export function grantCoins(userId: string, amount: number): void {
  sql(`with l as (insert into public.coin_ledger (user_id, delta, reason, ref_id)
         values ('${userId}', ${amount}, 'bonus', 'test-grant') returning delta)
       update public.profiles set coins = coins + (select delta from l) where id = '${userId}'`);
}

export function deleteUser(userId: string): void {
  sql(`delete from auth.users where id = '${userId}'`);
}
