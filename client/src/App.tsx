import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';
import { watchInputKind } from './game/touch';
import { uiStore, useUi } from './store';
import { AuthGate } from './ui/AuthGate';
import { ConnectionOverlay } from './ui/ConnectionOverlay';
import { FocusPanel } from './ui/FocusPanel';
import { HUD } from './ui/HUD';
import { ambient } from './audio/ambient';
import { music } from './audio/music';
import { useEditor } from './house/editor';
import { AudioPanel } from './ui/AudioPanel';
import { CharacterPanel } from './ui/CharacterPanel';
import { ChatPanel } from './ui/ChatPanel';
import { EditDrawer } from './ui/EditDrawer';
import { FriendsPanel } from './ui/FriendsPanel';
import { GamePanel, GamesPanel } from './ui/GamePanel';
import { HouseBar } from './ui/HouseBar';
import { HouseSettings } from './ui/HouseSettings';
import { InventoryDrawer } from './ui/InventoryDrawer';
import { MapControls } from './ui/MapControls';
import { MapPanel } from './ui/MapPanel';
import { MiniTimer } from './ui/MiniTimer';
import { Transition } from './ui/Transition';
import { WidgetLayer, WidgetPicker } from './ui/widgets/WidgetLayer';
import { ShopPanel } from './ui/ShopPanel';
import { StatsPanel } from './ui/StatsPanel';
import { Toast } from './ui/Toast';
import { PinchPopup } from './ui/PinchPopup';
import { Tutorial } from './ui/Tutorial';
import { TouchStick } from './ui/TouchStick';

function Game() {
  const gameRef = useRef<HTMLDivElement>(null);
  const editing = useEditor((s) => s.active);
  const focusing = useUi((s) => s.focus !== null);

  useEffect(() => {
    if (!gameRef.current) return;
    const game = createGame(gameRef.current);
    const unwatch = watchInputKind();
    return () => {
      unwatch();
      game.destroy(true);
      music.stop();
      ambient.stopAll();
      uiStore.reset();
    };
  }, []);

  return (
    <>
      <div ref={gameRef} className="game" />
      <div className={`overlay${focusing ? ' focusing-mode' : ''}`}>
        <WidgetLayer />
        <HUD />
        <AudioPanel />
        <HouseBar />
        <ChatPanel />
        <MapControls />
        <TouchStick />
        {!editing && <FocusPanel />}
        <MiniTimer />
        {editing ? <EditDrawer /> : <InventoryDrawer />}
        <ShopPanel />
        <HouseSettings />
        <GamePanel />
        <GamesPanel />
        <FriendsPanel />
        <StatsPanel />
        <CharacterPanel />
        <MapPanel />
        <WidgetPicker />
        <Toast />
        <PinchPopup />
        <Tutorial />
        <ConnectionOverlay />
        <Transition />
      </div>
    </>
  );
}

export function App() {
  return (
    <AuthGate>
      <Game />
    </AuthGate>
  );
}
