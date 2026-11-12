import { useEffect, useState } from 'react';
import { GAMES, GAME_IDS, PLAY_DAILY_CAP_MIN, reelMarker, type GameId } from '@focus-town/shared';
import { sfx } from '../audio/sfx';
import { goToGame, goToTown } from '../game/navigation';
import { interact } from '../game/touch';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi, type GameUi } from '../store';
import { Icon } from './Icon';

const SCORE_LABEL: Record<GameId, string> = {
  fishing: 'Points',
  rafting: 'Runs',
  butterflies: 'Points',
  treasure: 'Points',
};

/** Redraws on every animation frame while mounted, for things that move. */
function useFrame(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = requestAnimationFrame(function step() {
      setNow(Date.now());
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

/** The fishing bar: stop the marker in the green zone. */
function ReelBar({ reel }: { reel: NonNullable<GameUi['reel']> }) {
  const now = useFrame();
  const elapsed = now - reel.startedAt;
  const at = reelMarker(elapsed, reel.periodMs);
  const left = Math.max(0, 1 - elapsed / reel.limitMs);
  return (
    <div className="reel panel">
      <div className="reel-bar">
        <span
          className="reel-zone"
          style={{ left: `${reel.zoneStart * 100}%`, width: `${reel.zone * 100}%` }}
        />
        <span className="reel-marker" style={{ left: `${at * 100}%` }} />
      </div>
      <div className="reel-time" style={{ width: `${left * 100}%` }} />
    </div>
  );
}

function RaftClock({ startedAt }: { startedAt: number }) {
  const now = useFrame();
  return <span className="game-clock">{((now - startedAt) / 1000).toFixed(1)} s</span>;
}

/** The big action button: shown in every game, whatever "use" means right now. */
function ActionButton({ label, urgent }: { label: string; urgent: boolean }) {
  return (
    <button
      type="button"
      className={`game-action${urgent ? ' urgent' : ''}`}
      onClick={() => {
        sfx.play('click');
        interact();
      }}
    >
      {label}
    </button>
  );
}

/** What's going on in the mini-game you're at: how to play, your score, and how to leave. */
export function GamePanel() {
  const game = useUi((s) => s.game);
  const touch = useUi((s) => s.touch);
  // On a phone the panel starts folded, so it doesn't sit on the player.
  const [showHelp, setShowHelp] = useState(() => window.innerWidth > 700);
  if (!game) return null;
  const info = GAMES[game.id];
  const onRaft = game.raftStartedAt !== null;
  return (
    <>
      <aside className="panel game-panel">
        <div className="game-head">
          <strong className="game-title">{info.name}</strong>
          <button
            type="button"
            className="icon-btn"
            aria-label={showHelp ? 'Hide help' : 'Show help'}
            onClick={() => setShowHelp(!showHelp)}
          >
            <Icon name={showHelp ? 'minus' : 'plus'} size={12} />
          </button>
        </div>
        {showHelp && <p className="fine-print">{info.howTo}</p>}
        <div className="ring-stats">
          <span className="pill people">
            {SCORE_LABEL[game.id]} {game.score}
          </span>
          <span className="pill coins">+{game.coinsEarned}</span>
          <span className="pill streak">{game.playedMin} min</span>
        </div>
        {game.note && <div className="fine-print">{game.note}</div>}
        {(showHelp || game.capReached) && (
          <div className="fine-print">
            {game.capReached
              ? `Today's ${PLAY_DAILY_CAP_MIN} paid minutes are used up. Play on for fun!`
              : 'Each minute you really play earns half what a focus minute does.'}
          </div>
        )}
        <div className="row">
          {onRaft && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => {
                sfx.play('click');
                roomActions.gameUse();
              }}
            >
              Bail out
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => goToTown()}
          >
            Back to town
          </button>
        </div>
      </aside>

      {game.message && <div className="game-message panel">{game.message}</div>}
      {game.raftStartedAt !== null && <RaftClock startedAt={game.raftStartedAt} />}
      {game.reel && <ReelBar reel={game.reel} />}
      {game.prompt && (
        <ActionButton
          label={touch ? game.prompt : `${game.prompt} (E)`}
          urgent={game.prompt === 'Hook it!' || game.prompt === 'Stop!'}
        />
      )}
    </>
  );
}

/** The list of games to travel to. */
export function GamesPanel() {
  const open = useUi((s) => s.gamesOpen);
  const here = useUi((s) => s.game?.id ?? null);
  const focusing = useUi((s) => s.focus !== null);
  if (!open) return null;
  const close = () => uiStore.set({ gamesOpen: false });
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel card games-panel" onClick={(e) => e.stopPropagation()}>
        <header className="shop-header">
          <div>
            <h2 className="title">Games</h2>
            <p className="subtitle">
              A break from focusing. Every minute you really play earns half what a focus minute
              does, up to {PLAY_DAILY_CAP_MIN} minutes a day.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        {focusing && <div className="form-notice">Finish your focus session before playing.</div>}
        <div className="games-grid">
          {GAME_IDS.map((id) => {
            const g = GAMES[id];
            return (
              <button
                key={id}
                type="button"
                className={`game-card game-card-${id}`}
                disabled={focusing || here === id}
                onClick={() => {
                  sfx.play('click');
                  close();
                  goToGame({ game: id });
                }}
              >
                <strong>{g.name}</strong>
                <span>{g.tagline}</span>
                {here === id && <small>You are here</small>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
