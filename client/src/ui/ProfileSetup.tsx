import { useState, type FormEvent } from 'react';
import { parseAvatar, randomAvatar, usernameSchema, type Avatar } from '@focus-town/shared';
import { supabase } from '../net/supabase';
import { CharacterCreator } from './CharacterCreator';

interface Props {
  initialUsername: string;
  /** Pre-filled for brand-new players, e.g. from their Google name. */
  suggestedUsername?: string;
  /** The stored avatar; old-format or missing avatars start from a random character. */
  initialAvatar: unknown;
  onDone: () => void;
  /** Present when editing from inside the game. */
  onCancel?: () => void;
}

/** First-run screen (and in-game editor) for the username and the character. */
export function ProfileSetup({
  initialUsername,
  suggestedUsername = '',
  initialAvatar,
  onDone,
  onCancel,
}: Props) {
  const [username, setUsername] = useState(
    initialUsername.startsWith('player_') ? suggestedUsername : initialUsername,
  );
  const [avatar, setAvatar] = useState<Avatar>(() => parseAvatar(initialAvatar) ?? randomAvatar());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set up before the new characters: has a name, but an old-format avatar. */
  const returning =
    !onCancel && !initialUsername.startsWith('player_') && parseAvatar(initialAvatar) === null;

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
      p_avatar: avatar,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form className="panel card profile-setup" onSubmit={submit}>
      <h1 className="title">
        {onCancel ? 'Your character' : returning ? 'Meet the new you' : 'Make yourself at home'}
      </h1>
      {returning && (
        <p className="subtitle">The town got a new look. Make a character to go with it.</p>
      )}
      <label className="field">
        <span>Username</span>
        <input
          autoFocus={!onCancel}
          maxLength={16}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError(null);
          }}
          placeholder="e.g. sleepy_owl"
        />
      </label>
      <CharacterCreator value={avatar} onChange={setAvatar} />
      {error && <div className="form-error">{error}</div>}
      <div className="profile-actions">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : onCancel ? 'Save' : 'Enter town'}
        </button>
      </div>
    </form>
  );
}
