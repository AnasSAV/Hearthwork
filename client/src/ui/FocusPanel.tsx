import { useEffect, useState } from 'react';
import type { FocusBlock, FocusEndReason } from '@focus-town/shared';
import { requestFocusAlerts } from '../net/focusAlerts';
import { serverNow } from '../net/clock';
import { roomActions } from '../net/roomBridge';
import { uiStore, useUi, type ActiveFocus } from '../store';
import { fmtClock, useFocusClock, useNow, useTableTimer } from './focusClock';
import { miniTimerSupported, openMiniTimer } from './miniTimerWindow';

const MISS_TEXT: Record<string, string> = {
  late: 'a heartbeat arrived late',
  presence_pending: 'waiting for you to confirm you are here',
  idle: 'no keyboard, mouse or touch activity for 10 minutes',
  ahead_of_clock: 'the session just started',
};

export const SESSION_END_TEXT: Record<FocusEndReason, string> = {
  completed: 'Block complete. Nice work!',
  ended: 'Session ended.',
  replaced: 'You started a session somewhere else, so this one ended.',
  missed_beats: 'Lost contact with your timer, so the session ended.',
  left: 'You left, so the session ended.',
  table_finished: "Your table's Pomodoro is over.",
  error: 'The session was interrupted.',
};

const MINI_TIMER_KEY = 'focus-town:mini-timer';
const miniTimerWanted = () => {
  try {
    return localStorage.getItem(MINI_TIMER_KEY) !== 'off';
  } catch {
    return true;
  }
};

/** The countdown ring, shared by the focus panel and the mini timer. */
export function FocusRing({
  clock,
  progress,
  label,
}: {
  clock: string;
  progress: number;
  label: string;
}) {
  const R = 62;
  const C = 2 * Math.PI * R;
  return (
    <div className="ring">
      <svg viewBox="0 0 150 150">
        <circle className="track" cx="75" cy="75" r={R} />
        <circle
          className="fill"
          cx="75"
          cy="75"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))}
        />
      </svg>
      <div className="ring-center">
        <span className="ring-time">{clock}</span>
        <span className="ring-sub">{label}</span>
      </div>
    </div>
  );
}

function Chooser({ deskId, tableId }: { deskId: string; tableId: string | null }) {
  const [plan, setPlan] = useState<FocusBlock | null>(25);
  const table = useTableTimer(tableId);
  useNow();
  const touch = useUi((s) => s.touch);
  const [miniTimer, setMiniTimer] = useState(miniTimerWanted);
  const [requested, setStarting] = useState(false);
  const error = useUi((s) => s.focusError);
  // Waiting for the server: either focus:state arrives (panel switches) or focus:error does.
  const starting = requested && !error;

  const start = () => {
    setStarting(true);
    uiStore.set({ focusError: null });
    // Both need this click: browsers refuse them later, without a user gesture.
    requestFocusAlerts();
    if (miniTimer && miniTimerSupported()) void openMiniTimer();
    roomActions.startFocus(deskId, plan);
  };

  const options: { value: FocusBlock | null; label: string; hint: string }[] = [
    { value: 25, label: '25 min', hint: '+5 bonus' },
    { value: 50, label: '50 min', hint: '+12 bonus' },
    // Group tables share one block, so open-ended sessions are for solo desks.
    ...(tableId ? [] : [{ value: null, label: 'Open', hint: 'no limit' }]),
  ];

  return (
    <div className="panel focus-card">
      <div className="focus-title">{tableId ? 'Group table' : 'Focus session'}</div>
      {table ? (
        <p className="subtitle">
          This table&apos;s {table.plannedMin}-minute Pomodoro is running with {table.seated}{' '}
          {table.seated === 1 ? 'person' : 'people'}:{' '}
          <strong>{fmtClock((table.endsAt - serverNow()) / 1000)}</strong> left. Sit down to join
          it.
        </p>
      ) : (
        <>
          {tableId && (
            <p className="fine-print">
              You pick the block; everyone who sits at this table joins your countdown.
            </p>
          )}
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
        </>
      )}
      {miniTimerSupported() && (
        <label className="check">
          <input
            type="checkbox"
            checked={miniTimer}
            onChange={(e) => {
              setMiniTimer(e.target.checked);
              try {
                localStorage.setItem(MINI_TIMER_KEY, e.target.checked ? 'on' : 'off');
              } catch {
                // Not remembered; fine.
              }
            }}
          />
          Mini timer: a small window that stays on top of your other apps
        </label>
      )}
      <p className="fine-print">
        You earn about 1 coin per minute.{' '}
        {touch
          ? 'Keep this screen open: phones pause pages in the background.'
          : 'Minimize this window or work in other apps, and your timer keeps going.'}{' '}
        Every 25 minutes you&apos;ll be asked if you&apos;re still here.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={start} disabled={starting}>
          {starting ? 'Starting…' : table ? 'Join the table' : 'Start'}
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

function Running({ focus, tableId }: { focus: ActiveFocus; tableId: string | null }) {
  const { clock, progress, label } = useFocusClock(focus, tableId);
  const miniOpen = useUi((s) => s.miniTimer !== null);

  // The tab's title is one more place to see the time from another window.
  useEffect(() => {
    document.title = focus.awaitingPresence ? 'Still here? · Hearthwork' : `${clock} · Hearthwork`;
    return () => {
      document.title = 'Hearthwork';
    };
  }, [clock, focus.awaitingPresence]);

  return (
    <div className="panel focus-ring">
      <FocusRing clock={clock} progress={progress} label={label} />
      <div className="ring-stats">
        <span className="pill people">{focus.verifiedMin} min</span>
        <span className="pill coins">+{focus.coinsEarned}</span>
      </div>
      {focus.lastMiss && MISS_TEXT[focus.lastMiss] && (
        <div className="fine-print" style={{ maxWidth: 200, textAlign: 'center' }}>
          Last minute didn&apos;t count: {MISS_TEXT[focus.lastMiss]}.
        </div>
      )}
      <div className="row">
        {miniTimerSupported() && !miniOpen && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => void openMiniTimer()}
          >
            Pop out
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '4px 12px' }}
          onClick={() => roomActions.endFocus()}
        >
          End session
        </button>
      </div>
    </div>
  );
}

function PresencePrompt({ paused }: { paused: boolean }) {
  return (
    <div className="modal-backdrop">
      <div className="panel card">
        <h2 className="title">Still here?</h2>
        <p className="subtitle">
          {paused
            ? 'Your timer is paused until you confirm.'
            : 'Confirm in the next few minutes to keep your timer going.'}
        </p>
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
      <div className="focus-title">{SESSION_END_TEXT[summary.reason]}</div>
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
        <div className="focus-vignette" />
        <Running focus={focus} tableId={nearDesk?.table ?? null} />
        {focus.awaitingPresence && <PresencePrompt paused={focus.paused} />}
      </>
    );
  }
  if (summary) return <Summary />;
  if (timerOpen && nearDesk) return <Chooser deskId={nearDesk.id} tableId={nearDesk.table} />;
  return null;
}
