import { useState, type FormEvent } from 'react';
import { supabase } from '../net/supabase';

/**
 * If Google (via Supabase) sent the player back with an error, e.g. they cancelled, read it from
 * the URL once and tidy the URL so a reload doesn't show it again.
 */
function takeRedirectError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('error') ?? hash.get('error');
  if (!code) return null;
  const description = params.get('error_description') ?? hash.get('error_description');
  window.history.replaceState(null, '', window.location.pathname);
  if (code === 'access_denied') return 'Google sign-in was cancelled.';
  return description ? `Sign-in failed: ${description}` : 'Sign-in failed. Please try again.';
}

/** Google's "G" mark, in its brand colours. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(takeRedirectError);
  const [notice, setNotice] = useState<string | null>(null);
  const [toGoogle, setToGoogle] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
    } else if (mode === 'signup' && !result.data.session) {
      setNotice('Check your email to confirm your account, then sign in.');
    }
  }

  async function google() {
    setError(null);
    setToGoogle(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // On success the browser is already on its way to Google.
    if (error) {
      setToGoogle(false);
      setError(
        /provider is not enabled/i.test(error.message)
          ? 'Google sign-in isn’t switched on for this server yet. Use email for now.'
          : error.message,
      );
    }
  }

  return (
    <div className="screen">
      <form className="panel card" onSubmit={submit}>
        <h1 className="title">Hearthwork</h1>
        <p className="subtitle">Study together, earn coins, build a cozy home.</p>

        <button type="button" className="btn btn-google" onClick={google} disabled={toGoogle}>
          <GoogleLogo />
          {toGoogle ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <div className="divider">or</div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        <p className="fine-print credit">
          Art by{' '}
          <a href="https://limezu.itch.io" target="_blank" rel="noreferrer">
            LimeZu
          </a>
        </p>
      </form>
    </div>
  );
}
