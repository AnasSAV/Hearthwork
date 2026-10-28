import { useEffect, useRef, useState } from 'react';
import { decodeAvatar } from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { goToHouse } from '../game/navigation';
import { interact } from '../game/touch';
import { useEditor } from '../house/editor';
import { fetchMyHome } from '../net/houses';
import { supabase } from '../net/supabase';
import { showNotice, uiStore, useUi, type UiState } from '../store';
import { AvatarSprite } from './AvatarSprite';
import { Icon, type IconName } from './Icon';

/** Go to the home you live in (yours, or a friend's you moved into). */
export async function goHome(): Promise<void> {
  try {
    const home = await fetchMyHome();
    goToHouse({ ownerId: home.owner_id, at: 'door' });
  } catch (e) {
    showNotice(e instanceof Error ? e.message : String(e));
  }
}

/** Counts up to `value` so coin changes are visible, and reports how much it just went up. */
function useCountUp(value: number): { shown: number; gained: number | null } {
  const [shown, setShown] = useState(value);
  const [gained, setGained] = useState<number | null>(null);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (value === start) return;
    if (value > start) {
      setGained(value - start);
      sfx.play('coin');
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const clear = setTimeout(() => setGained(null), 1400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [value]);
  return { shown, gained };
}

function Tool({
  icon,
  label,
  onClick,
  active = false,
  dot,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  dot?: number;
}) {
  return (
    <button
      type="button"
      className={`tool${active ? ' active' : ''}`}
      data-tip={label}
      aria-label={label}
      onClick={() => {
        sfx.play('click');
        onClick();
      }}
    >
      <Icon name={icon} size={20} />
      {dot ? <span className="dot">{dot}</span> : null}
    </button>
  );
}

const toggle = (key: keyof UiState) => () => uiStore.set({ [key]: !uiStore.get()[key] });

/** "Press E" with a keyboard, a tappable button with a finger; either way it uses the spot. */
function Prompt({ touch, children }: { touch: boolean; children: string }) {
  return (
    <button
      type="button"
      className={`hint panel${touch ? ' tap' : ''}`}
      onClick={() => {
        sfx.play('click');
        interact();
      }}
    >
      {touch ? <Icon name="sparkle" size={16} /> : <kbd>E</kbd>} {children}
    </button>
  );
}

export function HUD() {
  const name = useUi((s) => s.playerName);
  const avatar = useUi((s) => s.playerAvatar);
  const online = useUi((s) => s.playersOnline);
  const focusingNow = useUi((s) => s.focusingNow);
  const wallet = useUi((s) => s.wallet);
  const connected = useUi((s) => s.connection.kind === 'connected');
  const nearDesk = useUi((s) => s.nearDesk);
  const nearShop = useUi((s) => s.nearShop);
  const shopOpen = useUi((s) => s.shopOpen);
  const focusing = useUi((s) => s.focus !== null);
  const house = useUi((s) => s.house);
  const mapOpen = useUi((s) => s.mapOpen);
  const friendsOpen = useUi((s) => s.friendsOpen);
  const statsOpen = useUi((s) => s.statsOpen);
  const inventoryOpen = useUi((s) => s.inventoryOpen);
  const characterOpen = useUi((s) => s.characterOpen);
  const widgetsOpen = useUi((s) => s.widgetPickerOpen);
  const editing = useEditor((s) => s.active);
  const timerOpen = useUi((s) => s.timerOpen);
  const touch = useUi((s) => s.touch);
  const coins = useCountUp(wallet?.coins ?? 0);
  // Phones fold the toolbar into a menu button; it closes again once a tool is picked.
  const [menuOpen, setMenuOpen] = useState(false);

  if (!connected) return null;
  const capReached = wallet && wallet.todayCoinMinutes >= wallet.dailyCapMin;
  return (
    <>
      <div className="hud panel">
        <div className="hud-avatar">
          {avatar && <AvatarSprite avatar={decodeAvatar(avatar)} scale={2} head />}
        </div>
        <div className="hud-who">
          <span className="hud-name">{name}</span>
          <span className="hud-stats">
            {wallet && (
              <>
                <span className="pill coins" key={wallet.coins} title="Coins">
                  <Icon name="coin" size={13} />
                  {coins.shown.toLocaleString()}
                </span>
                <span
                  className="pill streak"
                  title={`${wallet.streakDays}-day focus streak (UTC days). Streaks add up to +50% coins.`}
                >
                  <Icon name="flame" size={13} />
                  {wallet.streakDays}
                </span>
              </>
            )}
            <span className="pill people" title={`${online} here · ${focusingNow} focusing now`}>
              <Icon name="timer" size={13} />
              {focusingNow}
            </span>
          </span>
        </div>
        {coins.gained && <span className="coin-float">+{coins.gained}</span>}
      </div>

      <nav
        className={`toolbar${menuOpen ? ' open' : ''}`}
        aria-label="Menu"
        onClick={(e) => {
          if (e.target !== e.currentTarget) setMenuOpen(false);
        }}
      >
        <button
          type="button"
          className={`tool menu-toggle${menuOpen ? ' active' : ''}`}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            sfx.play('click');
            setMenuOpen(!menuOpen);
          }}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
        </button>
        {!house?.isMember && !focusing && (
          <Tool icon="home" label="Home" onClick={() => void goHome()} />
        )}
        {!focusing && (
          <Tool icon="map" label="Map (M)" onClick={toggle('mapOpen')} active={mapOpen} />
        )}
        <Tool icon="friends" label="Friends" onClick={toggle('friendsOpen')} active={friendsOpen} />
        <Tool
          icon="widgets"
          label="Widgets"
          onClick={toggle('widgetPickerOpen')}
          active={widgetsOpen}
        />
        <Tool icon="stats" label="Stats" onClick={toggle('statsOpen')} active={statsOpen} />
        {!editing && (
          <Tool
            icon="bag"
            label="Inventory (I)"
            onClick={toggle('inventoryOpen')}
            active={inventoryOpen}
          />
        )}
        <Tool
          icon="user"
          label="Character"
          onClick={toggle('characterOpen')}
          active={characterOpen}
        />
        <Tool icon="door" label="Sign out" onClick={() => void supabase.auth.signOut()} />
      </nav>

      {capReached && (
        <div className="cap panel">
          Daily coin cap reached ({wallet.dailyCapMin} min). Minutes still count for your streak.
        </div>
      )}
      {nearDesk && !focusing && !timerOpen && <Prompt touch={touch}>Sit down and focus</Prompt>}
      {nearShop && !shopOpen && <Prompt touch={touch}>Enter the Furniture Shop</Prompt>}
      {!editing && touch && (
        <div className="controls touch">
          <span>drag anywhere to walk</span>
          <span>pinch to zoom</span>
          <span>tap a player to whisper</span>
        </div>
      )}
      {!editing && !touch && (
        <div className="controls">
          <span>
            <kbd>WASD</kbd>walk
          </span>
          <span>
            <kbd>E</kbd>use
          </span>
          <span>
            <kbd>M</kbd>map
          </span>
          <span>
            <kbd>↵</kbd>chat
          </span>
          <span>
            <kbd>1-0</kbd>emotes
          </span>
          {house && <span>gate → town</span>}
        </div>
      )}
    </>
  );
}
