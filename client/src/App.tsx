import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';
import { uiStore } from './store';
import { AuthGate } from './ui/AuthGate';
import { ConnectionOverlay } from './ui/ConnectionOverlay';
import { FocusPanel } from './ui/FocusPanel';
import { HUD } from './ui/HUD';
import { InventoryDrawer } from './ui/InventoryDrawer';
import { ShopPanel } from './ui/ShopPanel';

function Game() {
  const gameRef = useRef<HTMLDivElement>(null);

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
        <FocusPanel />
        <InventoryDrawer />
        <ShopPanel />
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
