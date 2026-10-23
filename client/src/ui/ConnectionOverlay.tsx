import { useUi, type ConnectionStatus } from '../store';

function message(status: ConnectionStatus): { title: string; detail?: string } | null {
  switch (status.kind) {
    case 'connected':
      return null;
    case 'loading':
      return { title: 'Loading town…' };
    case 'connecting':
      return { title: 'Connecting…' };
    case 'waking':
      return {
        title: 'Waking up server…',
        detail:
          status.attempt > 1
            ? `The free server naps when nobody is around. This can take about a minute (attempt ${status.attempt}).`
            : 'The free server naps when nobody is around. This can take about a minute.',
      };
    case 'reconnecting':
      return { title: 'Connection lost, reconnecting…' };
    case 'error':
      return { title: 'Could not join the town', detail: status.message };
  }
}

export function ConnectionOverlay() {
  const status = useUi((s) => s.connection);
  const msg = message(status);
  if (!msg) return null;
  return (
    <div className="connection">
      <div className="panel connection-card">
        {status.kind !== 'error' && <div className="spinner" aria-hidden />}
        <div className="connection-title">{msg.title}</div>
        {msg.detail && <div className="connection-detail">{msg.detail}</div>}
        {status.kind === 'error' && (
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
