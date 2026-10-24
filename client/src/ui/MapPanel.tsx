import { useEffect, useState } from 'react';
import { goToHouse, goToTown } from '../game/navigation';
import { fetchWorldMap, type MapHome } from '../net/houses';
import { uiStore, useUi } from '../store';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frames of sprites/houses.png (Phaser atlas JSON), loaded once. */
let framesPromise: Promise<Record<string, Frame>> | null = null;
function houseFrames(): Promise<Record<string, Frame>> {
  framesPromise ??= fetch('/assets/sprites/houses.json')
    .then((r) => r.json() as Promise<{ frames: Record<string, { frame: Frame }> }>)
    .then((j) => Object.fromEntries(Object.entries(j.frames).map(([k, v]) => [k, v.frame])));
  return framesPromise;
}

const RING = 12;
const RELATION_LABEL: Record<MapHome['relation'], string> = {
  home: 'Your home',
  friend: 'Friend',
  public: 'Public',
};

function HouseIcon({ home, frames }: { home: MapHome; frames: Record<string, Frame> | null }) {
  const key = `${home.exterior_style === 'brick' ? 'brick' : 'cottage'}-${Math.min(3, home.level)}`;
  const f = frames?.[key];
  if (!f) return <span className="map-house-icon" />;
  const scale = 0.5;
  return (
    <span
      className="map-house-icon"
      style={{
        width: f.w * scale,
        height: f.h * scale,
        backgroundImage: 'url(/assets/sprites/houses.png)',
        backgroundPosition: `-${f.x * scale}px -${f.y * scale}px`,
        backgroundSize: `auto ${f.h * scale}px`,
      }}
    />
  );
}

/**
 * The world map: the town in the middle, your home, friends' homes you may visit and public
 * homes around it. Pick one to travel there.
 */
export function MapPanel() {
  const open = useUi((s) => s.mapOpen);
  const here = useUi((s) => s.house?.ownerId ?? 'town');
  const focusing = useUi((s) => s.focus !== null);
  const [homes, setHomes] = useState<MapHome[] | null>(null);
  const [frames, setFrames] = useState<Record<string, Frame> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchWorldMap(), houseFrames()])
      .then(([h, f]) => {
        if (cancelled) return;
        setHomes(h);
        setFrames(f);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;
  const close = () => uiStore.set({ mapOpen: false });
  const travel = (go: () => void) => {
    if (focusing) return;
    close();
    go();
  };
  const ring = homes?.slice(0, RING) ?? [];
  const more = homes?.slice(RING) ?? [];

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card world-map" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <div>
            <h2 className="title">Map</h2>
            <p className="subtitle">
              {focusing
                ? 'Finish your focus session before travelling.'
                : 'Your home, your friends’ homes and public homes. Pick one to go there.'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {error && <div className="form-error">{error}</div>}
        {!homes && !error && <div className="spinner" aria-label="Loading" />}
        {homes && (
          <div className="map-field">
            <svg className="map-paths" viewBox="-100 -100 200 200" preserveAspectRatio="none">
              {ring.map((h, i) => {
                const a = (i / Math.max(ring.length, 6)) * Math.PI * 2 - Math.PI / 2;
                return (
                  <line
                    key={h.owner_id}
                    x1={0}
                    y1={0}
                    x2={Math.cos(a) * 78}
                    y2={Math.sin(a) * 78}
                    className={h.relation}
                  />
                );
              })}
            </svg>
            <button
              type="button"
              className={`map-node map-town${here === 'town' ? ' here' : ''}`}
              disabled={focusing || here === 'town'}
              onClick={() => travel(() => goToTown())}
            >
              <span className="map-town-icon" />
              <strong>Town</strong>
              <small>{here === 'town' ? 'You are here' : 'Study plaza, café, library, shop'}</small>
            </button>
            {ring.map((h, i) => {
              const a = (i / Math.max(ring.length, 6)) * Math.PI * 2 - Math.PI / 2;
              return (
                <button
                  key={h.owner_id}
                  type="button"
                  className={`map-node map-home ${h.relation}${here === h.owner_id ? ' here' : ''}`}
                  style={{ left: `${50 + Math.cos(a) * 39}%`, top: `${50 + Math.sin(a) * 39}%` }}
                  disabled={focusing || here === h.owner_id}
                  title={h.members.join(', ')}
                  onClick={() =>
                    travel(() =>
                      goToHouse({
                        ownerId: h.owner_id,
                        at: h.relation === 'home' ? 'door' : 'gate',
                        label: h.relation === 'home' ? 'Home' : `${h.owner_name}'s home`,
                      }),
                    )
                  }
                >
                  <HouseIcon home={h} frames={frames} />
                  <strong>{h.relation === 'home' ? 'Home' : `${h.owner_name}'s`}</strong>
                  <small>
                    {here === h.owner_id ? 'You are here' : RELATION_LABEL[h.relation]}
                    {h.members.length > 1 ? ` · ${h.members.length} live here` : ''}
                  </small>
                </button>
              );
            })}
          </div>
        )}
        {more.length > 0 && (
          <div className="map-more">
            <h3 className="drawer-group">More homes</h3>
            {more.map((h) => (
              <div key={h.owner_id} className="friend-row">
                <span className="friend-name">
                  {h.owner_name}'s home{' '}
                  <small>
                    · {RELATION_LABEL[h.relation]} · Lv {h.level}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={focusing}
                  onClick={() =>
                    travel(() =>
                      goToHouse({ ownerId: h.owner_id, label: `${h.owner_name}'s home` }),
                    )
                  }
                >
                  Visit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
