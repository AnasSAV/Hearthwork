import { FOCUS_BEAT_INTERVAL_MS } from '@focus-town/shared';
import { uiStore } from '../store';
import { roomActions } from './roomBridge';

/**
 * Sends `focus:beat` every minute while a focus session runs, whether or not the window is
 * minimized. The beat only reports facts the browser knows (is the game window in front, how long
 * since the last keyboard/mouse input); the server decides whether the minute counts.
 *
 * Ticks come from a Web Worker because browsers throttle main-thread timers in background tabs
 * (Chrome aligns them to once a minute after 5 minutes hidden), which would make beats late and
 * freeze the on-screen clock. The same ticks drive that clock (see `onFocusTick`).
 */
let lastInputAt = Date.now();
let lastBeatAt = 0;
let worker: Worker | null = null;
let listening = false;

const markInput = () => {
  lastInputAt = Date.now();
};
const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;

function listenForInput(): void {
  if (listening) return;
  listening = true;
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, markInput, { passive: true });
}

const tickListeners = new Set<() => void>();

/** Called about once a second during a focus session, even in a minimized window. */
export function onFocusTick(listener: () => void): () => void {
  tickListeners.add(listener);
  return () => tickListeners.delete(listener);
}

function tick(): void {
  tickListeners.forEach((l) => l());
  if (!uiStore.get().focus) return;
  const now = Date.now();
  if (now - lastBeatAt < FOCUS_BEAT_INTERVAL_MS) return;
  lastBeatAt = now;
  roomActions.beat({
    inGame: document.visibilityState === 'visible' && document.hasFocus(),
    lastInputAgoSec: Math.max(0, Math.round((now - lastInputAt) / 1000)),
  });
}

/**
 * Keep the screen on while focusing. A phone that dims and locks hides the page, and hidden
 * minutes don't count. The browser drops the lock whenever the page is hidden, so take it again
 * on return. Not every browser has it; then the screen just sleeps as usual.
 */
let wakeLock: WakeLockSentinel | null = null;

async function holdScreenOn(): Promise<void> {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    // Refused (battery saver, no user gesture yet): nothing to do.
  }
}

const retakeWakeLock = () => {
  if (uiStore.get().focus) void holdScreenOn();
};

export function startHeartbeat(): void {
  listenForInput();
  void holdScreenOn();
  document.addEventListener('visibilitychange', retakeWakeLock);
  lastBeatAt = Date.now(); // first beat one minute after the session starts
  if (worker) return;
  const source = 'setInterval(() => postMessage(0), 1000);';
  worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  worker.onmessage = tick;
}

export function stopHeartbeat(): void {
  worker?.terminate();
  worker = null;
  document.removeEventListener('visibilitychange', retakeWakeLock);
  void wakeLock?.release();
  wakeLock = null;
}
