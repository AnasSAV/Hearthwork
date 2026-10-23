import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';
import { uiStore } from './store';
import { AuthGate } from './ui/AuthGate';
import { ConnectionOverlay } from './ui/ConnectionOverlay';
import { FocusPanel } from './ui/FocusPanel';
import { HUD } from './ui/HUD';
import { ambient } from './audio/ambient';
import { radio } from './audio/radio';
import { useEditor } from './house/editor';
import { AudioPanel } from './ui/AudioPanel';
import { ChatPanel } from './ui/ChatPanel';
import { EditDrawer } from './ui/EditDrawer';
import { FriendsPanel } from './ui/FriendsPanel';
import { HouseBar } from './ui/HouseBar';
import { HouseSettings } from './ui/HouseSettings';
import { InventoryDrawer } from './ui/InventoryDrawer';
import { ShopPanel } from './ui/ShopPanel';
import { StatsPanel } from './ui/StatsPanel';
import { Toast } from './ui/Toast';

function Game() {
  const gameRef = useRef<HTMLDivElement>(null);
  const editing = useEditor((s) => s.active);

  useEffect(() => {
    if (!gameRef.current) return;
    const game = createGame(gameRef.current);
    return () => {
      game.destroy(true);
      radio.stop();
      ambient.stopAll();
      uiStore.reset();
    };
  }, []);

  return (
    <>
      <div ref={gameRef} className="game" />
      <div className="overlay">
        <HUD />
        <AudioPanel />
        <HouseBar />
        <ChatPanel />
        {!editing && <FocusPanel />}
        {editing ? <EditDrawer /> : <InventoryDrawer />}
        <ShopPanel />
        <HouseSettings />
        <FriendsPanel />
        <StatsPanel />
        <Toast />
        <ConnectionOverlay />
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
