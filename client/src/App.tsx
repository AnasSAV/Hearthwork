import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';
import { uiStore } from './store';
import { AuthGate } from './ui/AuthGate';
import { ConnectionOverlay } from './ui/ConnectionOverlay';
import { FocusPanel } from './ui/FocusPanel';
import { HUD } from './ui/HUD';
import { useEditor } from './house/editor';
import { EditDrawer } from './ui/EditDrawer';
import { FriendsPanel } from './ui/FriendsPanel';
import { HouseBar } from './ui/HouseBar';
import { HouseSettings } from './ui/HouseSettings';
import { InventoryDrawer } from './ui/InventoryDrawer';
import { ShopPanel } from './ui/ShopPanel';
import { Toast } from './ui/Toast';

function Game() {
  const gameRef = useRef<HTMLDivElement>(null);
  const editing = useEditor((s) => s.active);

  useEffect(() => {
    if (!gameRef.current) return;
    const game = createGame(gameRef.current);
    return () => {
      game.destroy(true);
      uiStore.reset();
    };
  }, []);

  return (
    <>
      <div ref={gameRef} className="game" />
      <div className="overlay">
        <HUD />
        <HouseBar />
        {!editing && <FocusPanel />}
        {editing ? <EditDrawer /> : <InventoryDrawer />}
        <ShopPanel />
        <HouseSettings />
        <FriendsPanel />
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
