import { useEffect, useState } from 'react';
import {
  fetchHouseLevels,
  fetchMyHouse,
  fetchMyProgress,
  updateHouseSettings,
  upgradeHouse,
  type HouseLevel,
  type MyHouse,
} from '../net/houses';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi } from '../store';

interface Loaded {
  house: MyHouse;
  levels: HouseLevel[];
  coins: number;
  totalFocusMin: number;
}

const VISIBILITY: { id: MyHouse['visibility']; label: string; hint: string }[] = [
  { id: 'friends', label: 'Friends', hint: 'Only friends can visit' },
  { id: 'public', label: 'Public', hint: 'Anyone can visit' },
  { id: 'private', label: 'Private', hint: 'Only you' },
];

/** Owner's house settings: who may visit, exterior style, and upgrading. */
export function HouseSettings() {
  const open = useUi((s) => s.houseSettingsOpen);
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchMyHouse(), fetchHouseLevels(), fetchMyProgress()])
      .then(([house, levels, progress]) => {
        if (!cancelled && house) setData({ house, levels, ...progress });
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

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await task());
      roomActions.reloadHouse(); // the house room re-reads the house and redraws for everyone
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const next = data?.levels.find((l) => l.level === (data.house.level ?? 1) + 1);
  const hours = (min: number) => Math.floor(min / 60);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card settings" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <h2 className="title">House settings</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {!data && !error && <div className="spinner" aria-label="Loading" />}
        {data && (
          <>
            <div className="field">
              <span>Who can visit</span>
              <div className="segmented">
                {VISIBILITY.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={busy}
                    className={data.house.visibility === v.id ? 'selected' : ''}
                    onClick={() =>
                      void run(async () => {
                        await updateHouseSettings(v.id, data.house.exteriorStyle);
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
                    className={data.house.exteriorStyle === style ? 'selected' : ''}
                    onClick={() =>
                      void run(async () => {
                        await updateHouseSettings(data.house.visibility, style);
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
                    {next.rooms > 1 ? ` + a second room` : ''}. Costs{' '}
                    <strong>{next.cost_coins.toLocaleString()} coins</strong> and needs{' '}
                    <strong>{hours(next.min_total_focus_min)} h</strong> of total focus.
                  </p>
                  <p className="fine-print">
                    You have {data.coins.toLocaleString()} coins and {hours(data.totalFocusMin)} h{' '}
                    {data.totalFocusMin % 60} min of focus. Your furniture stays where it is; the
                    new space is added to the right and bottom.
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
