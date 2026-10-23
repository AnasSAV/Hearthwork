/**
 * Creates throwaway, already-confirmed players for bots and end-to-end tests.
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY (server/.env and
 * client/.env). Only meant for local or staging projects.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface TestPlayer {
  userId: string;
  username: string;
  token: string;
  /** Supabase client signed in as this player (anon key + their session). */
  client: SupabaseClient;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`Missing ${name}; run with --env-file=server/.env --env-file=client/.env`);
  return v;
}

export const serviceClient = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export async function createTestPlayer(prefix: string, body: number): Promise<TestPlayer> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `${prefix}_${suffix}`.slice(0, 16);
  const email = `${username.toLowerCase()}@bots.focus.town`;
  const password = `pw-${suffix}-${Date.now()}`;

  const admin = serviceClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);

  const client = createClient(env('SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session)
    throw new Error(`signIn: ${signedIn.error?.message}`);

  const profile = await client.rpc('update_profile', { p_username: username, p_avatar: { body } });
  if (profile.error) throw new Error(`update_profile: ${profile.error.message}`);

  return {
    userId: created.data.user.id,
    username,
    token: signedIn.data.session.access_token,
    client,
  };
}

export async function deleteTestPlayer(p: TestPlayer): Promise<void> {
  await serviceClient().auth.admin.deleteUser(p.userId);
}
