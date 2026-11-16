import { useEffect, useState, type FormEvent } from 'react';
import { goToHouse } from '../game/navigation';
import {
  fetchHouseLevels,
  fetchMyHome,
  fetchMyProgress,
  inviteHousemate,
  leaveHome,
  removeHousemate,
  respondHouseInvite,
  updateHouseSettings,
  upgradeHouse,
  type HouseLevel,
  type MyHome,
  type Visibility,
} from '../net/houses';
import { roomActions } from '../net/roomBridge';
import { supabase } from '../net/supabase';
import { uiStore, useUi } from '../store';
import { AvatarSprite } from './AvatarSprite';

interface Loaded {
  home: MyHome;
  levels: HouseLevel[];
  coins: number;
  totalFocusMin: number;
  me: string;
}

const VISIBILITY: { id: Visibility; label: string; hint: string }[] = [
  { id: 'friends', label: 'Friends', hint: 'Friends of anyone who lives here' },
  { id: 'public', label: 'Public', hint: 'Anyone, from the map' },
  { id: 'private', label: 'Private', hint: 'Only the people who live here' },
];

/** Settings for the home you live in: visitors, outside, size and who lives there. */
export function HouseSettings() {
  const open = useUi((s) => s.houseSettingsOpen);
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [inviteName, setInviteName] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchMyHome(), fetchHouseLevels(), fetchMyProgress(), supabase.auth.getSession()])
      .then(([home, levels, progress, session]) => {
        if (!cancelled)
          setData({ home, levels, ...progress, me: session.data.session?.user.id ?? '' });
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open, reload]);

  if (!open) return null;
  const close = () => {
    uiStore.set({ houseSettingsOpen: false });
    setError(null);
    setNotice(null);
  };

  /** Run a change, then have the house room re-read the home and refresh this panel. */
  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await task());
      roomActions.reloadHouse();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Moving changes which home you live in: go there. */
  async function moveTo(task: () => Promise<string>) {
    await run(task);
    const home = await fetchMyHome().catch(() => null);
    if (home) {
      close();
      goToHouse({ ownerId: home.owner_id, at: 'door' });
    }
  }

  const home = data?.home;
  const next = data?.levels.find((l) => l.level === (home?.level ?? 1) + 1);
  const hours = (min: number) => Math.floor(min / 60);
  const iOwn = !!data && home?.owner_id === data.me;
  const asking = home?.requests.filter((r) => !r.from_owner) ?? [];
  const invited = home?.requests.filter((r) => r.from_owner) ?? [];

  function invite(e: FormEvent) {
    e.preventDefault();
    const name = inviteName.trim();
    if (!name) return;
    void run(async () => {
      const r = await inviteHousemate(name);
      setInviteName('');
      return r === 'moved in' ? `${name} moved in!` : `Invited ${name} to live here.`;
    });
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card settings" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <h2 className="title">Home settings</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {!data && !error && <div className="spinner" aria-label="Loading" />}
        {data && home && (
          <>
            <div className="field">
              <span>Who lives here</span>
              <ul className="people-list">
                {home.members.map((m) => (
                  <li key={m.user_id} className="friend-row">
                    <AvatarSprite avatar={m.avatar} scale={2} head />
                    <span className="friend-name">
                      {m.username} {m.is_owner && <small>owner</small>}
                      {m.user_id === data.me && <small> (you)</small>}
                    </span>
                    {iOwn && !m.is_owner && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await removeHousemate(m.user_id);
                            return `${m.username} moved back to their own house.`;
                          })
                        }
                      >
                        Ask to move out
                      </button>
                    )}
                    {m.user_id === data.me && !m.is_owner && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          void moveTo(async () => {
                            await leaveHome();
                            return 'You moved back to your own house.';
                          })
                        }
                      >
                        Move out
                      </button>
                    )}
                  </li>
                ))}
                {asking.map((r) => (
                  <li key={r.user_id} className="friend-row">
                    <AvatarSprite avatar={r.avatar} scale={2} head />
                    <span className="friend-name">
                      {r.username} <small>wants to move in</small>
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await respondHouseInvite(r.user_id, true);
                          return `${r.username} moved in!`;
                        })
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await respondHouseInvite(r.user_id, false);
                          return 'Request declined.';
                        })
                      }
                    >
                      Decline
                    </button>
                  </li>
                ))}
                {invited.map((r) => (
                  <li key={r.user_id} className="friend-row muted">
                    <AvatarSprite avatar={r.avatar} scale={2} head />
                    <span className="friend-name">
                      {r.username} <small>invited</small>
                    </span>
                  </li>
                ))}
              </ul>
              <form className="row" onSubmit={invite}>
                <input
                  className="text-input"
                  value={inviteName}
                  maxLength={16}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Invite a friend to live here"
                />
                <button type="submit" className="btn" disabled={busy || !inviteName.trim()}>
                  Invite
                </button>
              </form>
              <p className="fine-print">
                Up to 4 people share a home. Everyone keeps their own coins and furniture, and can
                decorate inside and the garden.
              </p>
            </div>
            <div className="field">
              <span>Who can visit</span>
              <div className="segmented">
                {VISIBILITY.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={busy}
                    className={home.visibility === v.id ? 'selected' : ''}
                    onClick={() =>
                      void run(async () => {
                        await updateHouseSettings(v.id, home.exterior_style);
                        return `Visibility set to ${v.label.toLowerCase()}.`;
                      })
                    }
                  >
                    <strong>{v.label}</strong>
                    <small>{v.hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Outside</span>
              <div className="segmented two">
                {(['cottage', 'brick'] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    disabled={busy}
                    className={home.exterior_style === style ? 'selected' : ''}
                    onClick={() =>
                      void run(async () => {
                        await updateHouseSettings(home.visibility, style);
                        return `Your house now has ${style === 'brick' ? 'shuttered' : 'glass'} windows.`;
                      })
                    }
                  >
                    <strong>{style === 'brick' ? 'Shutters' : 'Classic'}</strong>
                    <small>{style === 'brick' ? 'Wooden shutters' : 'Glass windows'}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Size</span>
              {next ? (
                <div className="upgrade">
                  <p className="subtitle">
                    Level {next.level}: {next.width}×{next.height}
                    {next.rooms > 1 ? ` + a second room` : ''} inside and a bigger house outside.
                    Costs <strong>{next.cost_coins.toLocaleString()} coins</strong> and needs{' '}
                    <strong>{hours(next.min_total_focus_min)} h</strong> of total focus.
                  </p>
                  <p className="fine-print">
                    You have {data.coins.toLocaleString()} coins and {hours(data.totalFocusMin)} h{' '}
                    {data.totalFocusMin % 60} min of focus; whoever upgrades pays. Furniture stays
                    where it is; the new space is added to the right and bottom.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      busy ||
                      data.coins < next.cost_coins ||
                      data.totalFocusMin < next.min_total_focus_min
                    }
                    onClick={() =>
                      void run(async () => {
                        const r = await upgradeHouse();
                        const wallet = uiStore.get().wallet;
                        if (wallet) uiStore.set({ wallet: { ...wallet, coins: r.coins } });
                        return `Upgraded to level ${r.level}!`;
                      })
                    }
                  >
                    Upgrade to level {next.level}
                  </button>
                </div>
              ) : (
                <p className="subtitle">Your house is at the highest level.</p>
              )}
            </div>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
      </div>
    </div>
  );
}
