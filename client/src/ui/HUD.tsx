import { supabase } from '../net/supabase';
import { useUi } from '../store';

export function HUD() {
  const name = useUi((s) => s.playerName);
  const online = useUi((s) => s.playersOnline);
  const focusingNow = useUi((s) => s.focusingNow);
  const wallet = useUi((s) => s.wallet);
  const connected = useUi((s) => s.connection.kind === 'connected');
  const nearDesk = useUi((s) => s.nearDesk);
  const focusing = useUi((s) => s.focus !== null);
  const timerOpen = useUi((s) => s.timerOpen);

  if (!connected) return null;
  const capReached = wallet && wallet.todayCoinMinutes >= wallet.dailyCapMin;
  return (
    <>
      <div className="hud panel">
        <span className="hud-name">{name}</span>
        <span className="hud-sep" />
        {wallet && (
          <>
            <span className="hud-coins" title="Coins">
              ● {wallet.coins.toLocaleString()}
            </span>
            <span
              title={`${wallet.streakDays}-day focus streak (UTC days). Streaks add up to +50% coins.`}
            >
              🔥 {wallet.streakDays}
            </span>
            <span className="hud-sep" />
          </>
        )}
        <span title={`${online} in this town`}>
          {focusingNow} {focusingNow === 1 ? 'person' : 'people'} focusing now
        </span>
        <button type="button" className="link" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
      {capReached && (
        <div className="cap panel">
          Daily coin cap reached ({wallet.dailyCapMin} min). Minutes still count for your streak.
        </div>
      )}
      {nearDesk && !focusing && !timerOpen && (
        <div className="hint panel">
          Press <kbd>E</kbd> to start focusing
        </div>
      )}
      <div className="controls panel">WASD / arrow keys to walk · E to use a desk</div>
    </>
  );
}
