import { goToHouse } from '../game/navigation';
import { useEditor } from '../house/editor';
import { fetchMyHouse } from '../net/houses';
import { supabase } from '../net/supabase';
import { showNotice, uiStore, useUi } from '../store';

/** The town shows houses on its first six lots; others are reached through Home/Friends. */
const TOWN_LOTS = 6;

async function goHome() {
  try {
    const house = await fetchMyHouse();
    if (!house) return showNotice('You have no house yet.');
    goToHouse({
      ownerId: house.ownerId,
      ...(house.plotIndex !== null && house.plotIndex < TOWN_LOTS
        ? { fromPlot: house.plotIndex }
        : {}),
    });
  } catch (e) {
    showNotice(e instanceof Error ? e.message : String(e));
  }
}

export function HUD() {
  const name = useUi((s) => s.playerName);
  const online = useUi((s) => s.playersOnline);
  const focusingNow = useUi((s) => s.focusingNow);
  const wallet = useUi((s) => s.wallet);
  const connected = useUi((s) => s.connection.kind === 'connected');
  const nearDesk = useUi((s) => s.nearDesk);
  const nearShop = useUi((s) => s.nearShop);
  const shopOpen = useUi((s) => s.shopOpen);
  const focusing = useUi((s) => s.focus !== null);
  const nearLot = useUi((s) => s.nearLot);
  const house = useUi((s) => s.house);
  const editing = useEditor((s) => s.active);
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
        {!house?.isOwner && !focusing && (
          <button type="button" className="link" onClick={() => void goHome()}>
            Home
          </button>
        )}
        <button type="button" className="link" onClick={() => uiStore.set({ friendsOpen: true })}>
          Friends
        </button>
        <button type="button" className="link" onClick={() => uiStore.set({ statsOpen: true })}>
          Stats
        </button>
        {!editing && (
          <button
            type="button"
            className="link"
            onClick={() => uiStore.set({ inventoryOpen: !uiStore.get().inventoryOpen })}
          >
            Inventory
          </button>
        )}
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
      {nearLot && (
        <div className="hint panel">
          Press <kbd>E</kbd> to {nearLot.isMine ? 'go home' : `visit ${nearLot.ownerName}'s house`}
        </div>
      )}
      {nearShop && !shopOpen && (
        <div className="hint panel">
          Press <kbd>E</kbd> to enter the Furniture Shop
        </div>
      )}
      {!editing && (
        <div className="controls panel">
          WASD / arrows: walk · E: use · I: inventory · Enter: chat
          {house ? ' · walk out the door to leave' : ''}
        </div>
      )}
    </>
  );
}
