import { useState, type FormEvent } from 'react';
import { requestMoveIn } from '../net/houses';

/**
 * First-run step after making a character: start in your own home, or ask a friend to let you
 * move in with them. Asking needs their household to accept; until then you live at home.
 */
export function HomeChoice({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'choose' | 'friend'>('choose');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestMoveIn(username);
      setSent(
        result === 'moved in'
          ? `You moved in with ${username}!`
          : `Asked ${username} to let you move in. You'll live in your own home until someone there accepts.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel card home-choice">
      <h1 className="title">Where will you live?</h1>
      {mode === 'choose' && (
        <>
          <p className="subtitle">
            Everyone gets a little house with a garden. You can also share a home with friends: up
            to 4 people, each with their own coins and furniture.
          </p>
          <button type="button" className="btn" onClick={onDone}>
            Start in my own home
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('friend')}>
            Move in with a friend
          </button>
        </>
      )}
      {mode === 'friend' && !sent && (
        <form className="home-choice" onSubmit={ask}>
          <label className="field">
            <span>Your friend's username</span>
            <input
              autoFocus
              maxLength={16}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {busy ? 'Asking…' : 'Ask to move in'}
          </button>
          <button type="button" className="link" onClick={() => setMode('choose')}>
            Back
          </button>
        </form>
      )}
      {sent && (
        <>
          <p className="form-notice">{sent}</p>
          <button type="button" className="btn" onClick={onDone}>
            Enter
          </button>
        </>
      )}
    </div>
  );
}
