import { useState, type FormEvent } from 'react';
import { AVATAR_COUNT, usernameSchema } from '@focus-town/shared';
import { supabase } from '../net/supabase';
import { AvatarSprite } from './AvatarSprite';

interface Props {
  initialUsername: string;
  initialBody: number | null;
  onDone: () => void;
}

/** First-run (and later: edit) screen for picking a username and an avatar. */
export function ProfileSetup({ initialUsername, initialBody, onDone }: Props) {
  const [username, setUsername] = useState(
    initialUsername.startsWith('player_') ? '' : initialUsername,
  );
  const [body, setBody] = useState(initialBody ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setError('Username: 3–16 letters, digits or underscores.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('update_profile', {
      p_username: parsed.data,
      p_avatar: { body },
    });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <div className="screen">
      <form className="panel card" onSubmit={submit}>
        <h1 className="title">Make yourself at home</h1>
        <label className="field">
          <span>Username</span>
          <input
            autoFocus
            maxLength={16}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            placeholder="e.g. sleepy_owl"
          />
        </label>
        <div className="field">
          <span>Avatar</span>
          <div className="avatar-grid">
            {Array.from({ length: AVATAR_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`avatar-choice${i === body ? ' selected' : ''}`}
                onClick={() => setBody(i)}
                aria-label={`Avatar ${i + 1}`}
              >
                <AvatarSprite body={i} scale={3} />
              </button>
            ))}
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Enter town'}
        </button>
      </form>
    </div>
  );
}
