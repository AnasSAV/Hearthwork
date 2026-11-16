import { useState } from 'react';
import { sfx } from '../audio/sfx';
import { useMinimap } from '../game/minimap';
import { setZoom, uiStore, useUi, ZOOM_RANGE } from '../store';
import { Icon } from './Icon';

/** The town as a little map with everyone on it; zoom in to see around you. */
function Minimap() {
  const { width, height, me, others } = useMinimap();
  const [scale, setScale] = useState(1);
  if (!width || !me) return null;
  const pct = (p: { x: number; y: number }) => ({
    left: `${(p.x / width) * 100}%`,
    top: `${(p.y / height) * 100}%`,
  });
  // Zoomed in, keep yourself in the middle.
  const shift =
    scale > 1
      ? `translate(${(0.5 - me.x / width) * 100}%, ${(0.5 - me.y / height) * 100}%) scale(${scale})`
      : 'none';
  return (
    <div className="minimap panel">
      <div className="minimap-head">
        <strong>Town</strong>
        <span className="pill people">{others.length + 1} here</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Zoom map"
          onClick={() => setScale(scale === 1 ? 2.5 : 1)}
        >
          <Icon name={scale === 1 ? 'plus' : 'minus'} size={12} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close map"
          onClick={() => uiStore.set({ minimapOpen: false })}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="minimap-view">
        <div className="minimap-world" style={{ transform: shift }}>
          {others.map((o, i) => (
            <span key={i} className={`mm-dot${o.focusing ? ' focusing' : ''}`} style={pct(o)} />
          ))}
          <span className="mm-dot me" style={pct(me)} />
        </div>
      </div>
    </div>
  );
}

/** Zoom buttons (also the mouse wheel) and the minimap toggle, bottom right. */
export function MapControls() {
  const connected = useUi((s) => s.connection.kind === 'connected');
  const zoom = useUi((s) => s.zoom);
  const minimapOpen = useUi((s) => s.minimapOpen);
  const inTown = useUi((s) => s.house === null && s.game === null);
  const focusing = useUi((s) => s.focus !== null);
  if (!connected) return null;
  const step = (d: number) => {
    sfx.play('click');
    setZoom(zoom + d);
  };
  return (
    <>
      {minimapOpen && inTown && !focusing && <Minimap />}
      <div className="zoom-controls">
        {inTown && (
          <button
            type="button"
            className={`tool${minimapOpen ? ' active' : ''}`}
            data-tip="Minimap"
            data-tip-up=""
            aria-label="Minimap"
            onClick={() => {
              sfx.play('click');
              uiStore.set({ minimapOpen: !minimapOpen });
            }}
          >
            <Icon name="map" size={18} />
          </button>
        )}
        <button
          type="button"
          className="tool"
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_RANGE.max}
          onClick={() => step(1)}
        >
          <Icon name="plus" size={18} />
        </button>
        <button
          type="button"
          className="tool"
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_RANGE.min}
          onClick={() => step(-1)}
        >
          <Icon name="minus" size={18} />
        </button>
      </div>
    </>
  );
}
