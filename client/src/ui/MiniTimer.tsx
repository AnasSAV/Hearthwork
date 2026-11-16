import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi, type ActiveFocus } from '../store';
import { FocusRing, SESSION_END_TEXT } from './FocusPanel';
import { useFocusClock } from './focusClock';

/** The mini timer shows this in its title bar. */
const setTitle = (win: Window, title: string) => {
  win.document.title = title;
};

function Running({ focus, win }: { focus: ActiveFocus; win: Window }) {
  const tableId = useUi((s) => s.nearDesk?.table ?? null);
  const { clock, progress, label } = useFocusClock(focus, tableId);
  useEffect(() => {
    setTitle(win, focus.awaitingPresence ? 'Still here?' : `${clock} · Hearthwork`);
  }, [win, clock, focus.awaitingPresence]);

  if (focus.awaitingPresence) {
    return (
      <div className="mini-timer">
        <strong className="mini-title">Still here?</strong>
        <p className="fine-print">
          {focus.paused
            ? 'Your timer is paused until you answer.'
            : 'Answer in the next few minutes to keep your timer going.'}
        </p>
        <button type="button" className="btn" onClick={() => roomActions.confirmPresence()}>
          I&apos;m here
        </button>
      </div>
    );
  }
  return (
    <div className="mini-timer">
      <FocusRing clock={clock} progress={progress} label={label} />
      <div className="ring-stats">
        <span className="pill people">{focus.verifiedMin} min</span>
        <span className="pill coins">+{focus.coinsEarned}</span>
      </div>
    </div>
  );
}

function Finished({ win }: { win: Window }) {
  const summary = useUi((s) => s.focusSummary);
  useEffect(() => {
    setTitle(win, 'Session over');
  }, [win]);
  if (!summary) return null;
  return (
    <div className="mini-timer">
      <strong className="mini-title">{SESSION_END_TEXT[summary.reason]}</strong>
      <div className="ring-stats">
        <span className="pill people">{summary.verifiedMin} min</span>
        <span className="pill coins">+{summary.coinsEarned}</span>
      </div>
      <button type="button" className="btn" onClick={() => uiStore.set({ focusSummary: null })}>
        Done
      </button>
    </div>
  );
}

/**
 * The always-on-top mini timer: the running session in a small window that floats over other
 * apps, so the countdown and the "still here?" question stay in view while you work.
 */
export function MiniTimer() {
  const win = useUi((s) => s.miniTimer);
  const focus = useUi((s) => s.focus);
  const summary = useUi((s) => s.focusSummary);
  const timerOpen = useUi((s) => s.timerOpen);
  const failed = useUi((s) => s.focusError !== null);
  // Opened from the Start click, so it may wait a moment for the session to begin.
  const over = !focus && !summary && (!timerOpen || failed);
  useEffect(() => {
    if (win && over) win.close();
  }, [win, over]);
  // Signing out or leaving the game takes the window with it.
  useEffect(() => () => uiStore.get().miniTimer?.close(), []);

  if (!win) return null;
  return createPortal(
    focus ? (
      <Running focus={focus} win={win} />
    ) : summary ? (
      <Finished win={win} />
    ) : (
      <div className="mini-timer">
        <strong className="mini-title">Starting…</strong>
      </div>
    ),
    win.document.body,
  );
}
