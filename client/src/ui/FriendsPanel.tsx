import { useEffect, useState, type FormEvent } from 'react';
import { goToHouse } from '../game/navigation';
import {
  fetchFriends,
  fetchMyHome,
  removeFriend,
  requestMoveIn,
  respondFriendRequest,
  respondHouseInvite,
  sendFriendRequest,
  type Friend,
  type MyHome,
} from '../net/houses';
import { uiStore, useUi } from '../store';
import { AvatarSprite } from './AvatarSprite';

const SEND_RESULT: Record<string, string> = {
  requested: 'Friend request sent.',
  accepted: 'They had already asked you, so you are now friends.',
  'already friends': 'You are already friends.',
  'already requested': 'Request already sent.',
};

/**
 * Friends and requests: add by username, accept/decline, visit their homes, ask to move in,
 * and answer invitations to live with someone.
 */
export function FriendsPanel() {
  const open = useUi((s) => s.friendsOpen);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [home, setHome] = useState<MyHome | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchFriends(), fetchMyHome()])
      .then(([f, h]) => {
        if (cancelled) return;
        setFriends(f);
        setHome(h);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  if (!open) return null;
  const close = () => {
    uiStore.set({ friendsOpen: false });
    setError(null);
    setNotice(null);
  };

  async function act(task: () => Promise<string | undefined>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await task();
      if (msg) setNotice(msg);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    void act(async () => {
      const result = await sendFriendRequest(username);
      setName('');
      return SEND_RESULT[result] ?? result;
    });
  }

  const incoming = friends?.filter((f) => f.status === 'pending' && f.incoming) ?? [];
  const outgoing = friends?.filter((f) => f.status === 'pending' && !f.incoming) ?? [];
  const accepted = friends?.filter((f) => f.status === 'accepted') ?? [];
  const invitations = home?.invites.filter((i) => i.from_owner) ?? [];
  const waitingOn = new Set(home?.invites.filter((i) => !i.from_owner).map((i) => i.owner_id));

  /** Your home changed (you moved in somewhere): go there. */
  async function moveIn(task: () => Promise<string>) {
    await act(async () => {
      const result = await task();
      if (result !== 'moved in') return 'Asked to move in. They need to accept.';
      const h = await fetchMyHome();
      close();
      goToHouse({ ownerId: h.owner_id, at: 'door' });
      return undefined;
    });
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card friends" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <h2 className="title">Friends</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <form className="row" onSubmit={add}>
          <input
            className="text-input"
            placeholder="Add a friend by username"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        {!friends && !error && <div className="spinner" aria-label="Loading" />}

        {invitations.length > 0 && <h3 className="drawer-group">Invitations to move in</h3>}
        {invitations.map((i) => (
          <div key={i.owner_id} className="friend-row">
            <span className="friend-name">
              {i.owner_name}'s home <small>invited you to live there</small>
            </span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void moveIn(() => respondHouseInvite(i.owner_id, true))}
            >
              Move in
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => void (await respondHouseInvite(i.owner_id, false)))
              }
            >
              Decline
            </button>
          </div>
        ))}

        {incoming.length > 0 && <h3 className="drawer-group">Requests</h3>}
        {incoming.map((f) => (
          <div key={f.user_id} className="friend-row">
            <AvatarSprite avatar={f.avatar} scale={2} head />
            <span className="friend-name">{f.username}</span>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void act(async () => void (await respondFriendRequest(f.user_id, true)))
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => void (await respondFriendRequest(f.user_id, false)))
              }
            >
              Decline
            </button>
          </div>
        ))}

        <h3 className="drawer-group">Friends</h3>
        {friends && accepted.length === 0 && (
          <p className="subtitle">No friends yet. Add someone by their username.</p>
        )}
        {accepted.map((f) => (
          <div key={f.user_id} className="friend-row">
            <AvatarSprite avatar={f.avatar} scale={2} head />
            <span className="friend-name">
              {f.username}
              {f.house_level ? <small> · house Lv {f.house_level}</small> : null}
            </span>
            <button
              type="button"
              className="btn"
              disabled={!f.can_visit}
              title={f.can_visit ? 'Visit their home' : 'Their home is private'}
              onClick={() => {
                close();
                goToHouse({ ownerId: f.home_owner ?? f.user_id, label: `${f.username}'s home` });
              }}
            >
              Visit
            </button>
            {home && f.home_owner && f.home_owner !== home.owner_id && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || waitingOn.has(f.home_owner)}
                title="Ask to live in their home"
                onClick={() => void moveIn(() => requestMoveIn(f.username))}
              >
                {waitingOn.has(f.home_owner) ? 'Asked' : 'Move in'}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Remove friend"
              disabled={busy}
              onClick={() => void act(async () => void (await removeFriend(f.user_id)))}
            >
              ✕
            </button>
          </div>
        ))}

        {outgoing.length > 0 && <h3 className="drawer-group">Sent</h3>}
        {outgoing.map((f) => (
          <div key={f.user_id} className="friend-row muted">
            <AvatarSprite avatar={f.avatar} scale={2} head />
            <span className="friend-name">{f.username}</span>
            <small>waiting…</small>
            <button
              type="button"
              className="icon-btn"
              title="Cancel request"
              disabled={busy}
              onClick={() => void act(async () => void (await removeFriend(f.user_id)))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
