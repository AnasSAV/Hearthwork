import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';
import { ConnectionOverlay } from './ui/ConnectionOverlay';
import { HUD } from './ui/HUD';

export function App() {
  const gameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gameRef.current) return;
    const game = createGame(gameRef.current);
    return () => game.destroy(true);
  }, []);

  return (
    <>
      <div ref={gameRef} className="game" />
      <div className="overlay">
        <HUD />
        <ConnectionOverlay />
      </div>
    </>
  );
}
