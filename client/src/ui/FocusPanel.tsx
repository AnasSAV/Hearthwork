import { useEffect, useState } from 'react';
import type { FocusBlock, FocusEndReason } from '@focus-town/shared';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi, type ActiveFocus } from '../store';

const MISS_TEXT: Record<string, string> = {
  late: 'a heartbeat arrived late',
  presence_pending: 'waiting for you to confirm you are here',
  hidden: 'the tab was in the background',
  idle: 'no keyboard or mouse activity for 10 minutes',
  ahead_of_clock: 'the session just started',
};

const END_TEXT: Record<FocusEndReason, string> = {
  completed: 'Block complete. Nice work!',
  ended: 'Session ended.',
  replaced: 'You started a session somewhere else, so this one ended.',
  missed_beats: 'Lost contact with your timer, so the session ended.',
  left: 'You left the town, so the session ended.',
  error: 'The session was interrupted.',
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const fmt = (totalSec: number) => {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Seconds of focus the server has verified, plus the current minute in progress. */
function shownSeconds(focus: ActiveFocus, now: number): number {
  const inProgress = focus.awaitingPresence ? 0 : Math.min(60, (now - focus.receivedAt) / 1000);
  return focus.verifiedMin * 60 + inProgress;
}

function Chooser({ deskId }: { deskId: string }) {
  const [plan, setPlan] = useState<FocusBlock | null>(25);
  const [audioOnly, setAudioOnly] = useState(false);
  const [requested, setStarting] = useState(false);
  const error = useUi((s) => s.focusError);
  // Waiting for the server: either focus:state arrives (panel switches) or focus:error does.
  const starting = requested && !error;

  const start = () => {
    setStarting(true);
    uiStore.set({ focusError: null });
    roomActions.startFocus(deskId, plan, audioOnly);
  };

  const options: { value: FocusBlock | null; label: string; hint: string }[] = [
    { value: 25, label: '25 min', hint: '+5 bonus' },
    { value: 50, label: '50 min', hint: '+12 bonus' },
    { value: null, label: 'Open', hint: 'no limit' },
  ];

  return (
    <div className="panel focus-card">
      <div className="focus-title">Focus session</div>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            className={plan === o.value ? 'selected' : ''}
            onClick={() => setPlan(o.value)}
          >
            <strong>{o.label}</strong>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={audioOnly}
          onChange={(e) => setAudioOnly(e.target.checked)}
        />
        Audio-only: minutes count while this tab is in the background
      </label>
      <p className="fine-print">
        You earn about 1 coin per verified minute. A minute counts when the tab is open (or
        audio-only is on) and you have used the keyboard or mouse in the last 10 minutes.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={start} disabled={starting}>
          {starting ? 'Starting…' : 'Start'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => uiStore.set({ timerOpen: false, focusError: null })}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Running({ focus }: { focus: ActiveFocus }) {
  const now = useNow();
  const elapsed = shownSeconds(focus, now);
  const clock = focus.plannedMin ? fmt(focus.plannedMin * 60 - elapsed) : fmt(elapsed);

  return (
    <div className="panel focus-card running">
      <div className="focus-title">
        {focus.plannedMin ? `${focus.plannedMin}-minute block` : 'Open session'}
        {focus.audioOnly && <span className="tag">audio-only</span>}
      </div>
      <div className="clock">{clock}</div>
      <div className="focus-stats">
        <span>{focus.verifiedMin} min verified</span>
        <span>+{focus.coinsEarned} coins</span>
      </div>
      {focus.lastMiss && MISS_TEXT[focus.lastMiss] && (
        <div className="form-notice">
          Last minute didn&apos;t count: {MISS_TEXT[focus.lastMiss]}.
        </div>
      )}
      <button type="button" className="btn btn-secondary" onClick={() => roomActions.endFocus()}>
        End session
      </button>
    </div>
  );
}

function PresencePrompt() {
  return (
    <div className="modal-backdrop">
      <div className="panel card">
        <h2 className="title">Still here?</h2>
        <p className="subtitle">Confirm to keep earning. Your timer is paused until you do.</p>
        <button
          type="button"
          className="btn"
          autoFocus
          onClick={() => roomActions.confirmPresence()}
        >
          I&apos;m here
        </button>
      </div>
    </div>
  );
}

function Summary() {
  const summary = useUi((s) => s.focusSummary);
  if (!summary) return null;
  return (
    <div className="panel focus-card">
      <div className="focus-title">{END_TEXT[summary.reason]}</div>
      <div className="focus-stats">
        <span>{summary.verifiedMin} min verified</span>
        <span>
          +{summary.coinsEarned} coins{summary.bonus > 0 ? ` (incl. ${summary.bonus} bonus)` : ''}
        </span>
      </div>
      <button type="button" className="btn" onClick={() => uiStore.set({ focusSummary: null })}>
        Done
      </button>
    </div>
  );
}

export function FocusPanel() {
  const focus = useUi((s) => s.focus);
  const timerOpen = useUi((s) => s.timerOpen);
  const nearDesk = useUi((s) => s.nearDesk);
  const summary = useUi((s) => s.focusSummary);

  if (focus) {
    return (
      <>
        <Running focus={focus} />
        {focus.awaitingPresence && <PresencePrompt />}
      </>
    );
  }
  if (summary) return <Summary />;
  if (timerOpen && nearDesk) return <Chooser deskId={nearDesk.id} />;
  return null;
}
