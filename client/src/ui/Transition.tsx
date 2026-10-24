import { useEffect, useState } from 'react';
import { decodeAvatar } from '@focus-town/shared';
import { useUi } from '../store';
import { AvatarSprite } from './AvatarSprite';

/**
 * The travel transition: an iris closes on you (with a honey rim), clouds drift by while the
 * destination's name pops up and your character walks along, then the iris opens on the new
 * world. Driven by `uiStore.transition` (see game/navigation).
 */
export function Transition() {
  const { phase, label } = useUi((s) => s.transition);
  const avatar = useUi((s) => s.playerAvatar);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (phase === 'idle') return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 6), 110);
    return () => clearInterval(t);
  }, [phase]);

  if (phase === 'idle') return null;
  return (
    <div className={`transition ${phase}`} aria-live="polite">
      <div className="iris" />
      {phase === 'covered' && (
        <div className="travel">
          <span className="cloud c1" />
          <span className="cloud c2" />
          <span className="cloud c3" />
          <div className="travel-card">
            <small>Heading to</small>
            <strong>{label}</strong>
            {avatar && (
              <span className="travel-walker">
                <AvatarSprite
                  avatar={decodeAvatar(avatar)}
                  scale={3}
                  dir="right"
                  anim="walk"
                  frame={frame}
                />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
