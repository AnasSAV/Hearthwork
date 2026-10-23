import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../net/supabase';
import { Login } from './Login';
import { ProfileSetup } from './ProfileSetup';

interface ProfileRow {
  username: string;
  avatar: { body?: number } | null;
}

type ProfileGate =
  { kind: 'setup'; profile: ProfileRow } | { kind: 'ready' } | { kind: 'error'; message: string };

async function fetchProfileGate(userId: string): Promise<ProfileGate> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, avatar')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();
  if (error) return { kind: 'error', message: error.message };
  if (!data) return { kind: 'error', message: 'Your profile is missing.' };
  if (typeof data.avatar?.body !== 'number') return { kind: 'setup', profile: data };
  return { kind: 'ready' };
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="screen">{children}</div>;
}

/** Shows login → profile setup → the game, depending on the Supabase session and profile. */
export function AuthGate({ children }: { children: ReactNode }) {
  /** undefined = still restoring the session from storage. */
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** Profile check result, tagged with the user it belongs to. */
  const [profile, setProfile] = useState<{ userId: string; gate: ProfileGate } | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(() => {
    if (!userId) return () => undefined;
    let cancelled = false;
    void fetchProfileGate(userId).then((gate) => {
      if (!cancelled) setProfile({ userId, gate });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(refreshProfile, [refreshProfile]);

  if (!supabaseConfigured) {
    return (
      <Centered>
        <div className="panel card">
          <h1 className="title">Almost there</h1>
          <p className="subtitle">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env, then restart the dev
            server. See docs/SETUP.md.
          </p>
        </div>
      </Centered>
    );
  }
  if (session === undefined) {
    return (
      <Centered>
        <div className="spinner" aria-label="Loading" />
      </Centered>
    );
  }
  if (!userId) return <Login />;

  const gate = profile?.userId === userId ? profile.gate : null;
  if (!gate) {
    return (
      <Centered>
        <div className="spinner" aria-label="Loading" />
      </Centered>
    );
  }
  switch (gate.kind) {
    case 'setup':
      return (
        <ProfileSetup
          initialUsername={gate.profile.username}
          initialBody={gate.profile.avatar?.body ?? null}
          onDone={() => void refreshProfile()}
        />
      );
    case 'error':
      return (
        <Centered>
          <div className="panel card">
            <h1 className="title">Something went wrong</h1>
            <p className="form-error">{gate.message}</p>
            <button className="btn" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </Centered>
      );
    case 'ready':
      return <>{children}</>;
  }
}
