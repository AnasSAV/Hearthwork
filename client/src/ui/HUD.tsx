import { useUi } from '../store';

export function HUD() {
  const name = useUi((s) => s.playerName);
  const online = useUi((s) => s.playersOnline);
  const connected = useUi((s) => s.connection.kind === 'connected');
  const nearDesk = useUi((s) => s.nearDesk);

  if (!connected) return null;
  return (
    <>
      <div className="hud panel">
        <span className="hud-name">{name}</span>
        <span className="hud-sep" />
        <span>
          {online} {online === 1 ? 'person' : 'people'} in town
        </span>
      </div>
      {nearDesk && <div className="hint panel">A desk. The focus timer arrives in Phase 2.</div>}
      <div className="controls panel">WASD / arrow keys to walk</div>
    </>
  );
}
