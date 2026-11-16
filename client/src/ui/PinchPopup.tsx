import { useEffect } from 'react';
import { sfx } from '../audio/sfx';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi } from '../store';
import { Icon } from './Icon';

const SHOW_MS = 9_000;

/** "Ana pinched you!", with a button to pinch back. */
export function PinchPopup() {
  const pinch = useUi((s) => s.pinch);

  useEffect(() => {
    if (!pinch) return;
    const id = setTimeout(() => uiStore.set({ pinch: null }), SHOW_MS);
    return () => clearTimeout(id);
  }, [pinch]);

  if (!pinch) return null;
  return (
    <div className="panel pinch-popup" role="status" key={pinch.at}>
      <span className="pinch-hand">
        <Icon name="hand" size={26} />
      </span>
      <span className="pinch-text">
        <strong>{pinch.fromName}</strong> pinched you!
      </span>
      <button
        type="button"
        className="btn"
        onClick={() => {
          sfx.play('pop');
          roomActions.pinch(pinch.fromId);
          uiStore.set({ pinch: null });
        }}
      >
        Pinch back
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => uiStore.set({ pinch: null })}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
