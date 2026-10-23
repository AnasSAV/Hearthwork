import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client. Uses the public anon/publishable key only: everything it can do is
 * limited by Row Level Security. The service-role key lives on the game server and never here.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Dev-only console handle, e.g. to check that RLS blocks
// `await __supabase.from('profiles').update({ coins: 99999 }).eq('id', '<your id>')`.
if (import.meta.env.DEV)
  (window as unknown as { __supabase: typeof supabase }).__supabase = supabase;
