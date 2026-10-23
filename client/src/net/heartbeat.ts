import { FOCUS_BEAT_INTERVAL_MS } from '@focus-town/shared';
import { uiStore } from '../store';
import { townActions } from './townBridge';

/**
 * Sends `focus:beat` every minute while a focus session runs. The beat only reports facts the
 * browser knows (is the tab visible, how long since the last keyboard/mouse input); the server
 * decides whether the minute counts.
 *
 * Ticks come from a Web Worker because browsers throttle main-thread timers in background tabs
 * (Chrome aligns them to once a minute after 5 minutes hidden), which would make beats late.
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

function tick(): void {
  if (!uiStore.get().focus) return;
  const now = Date.now();
  if (now - lastBeatAt < FOCUS_BEAT_INTERVAL_MS) return;
  lastBeatAt = now;
  townActions.beat({
    visible: document.visibilityState === 'visible',
    lastInputAgoSec: Math.max(0, Math.round((now - lastInputAt) / 1000)),
  });
}

export function startHeartbeat(): void {
  listenForInput();
  lastBeatAt = Date.now(); // first beat one minute after the session starts
  if (worker) return;
  const source = 'setInterval(() => postMessage(0), 2000);';
  worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  worker.onmessage = tick;
}

export function stopHeartbeat(): void {
  worker?.terminate();
  worker = null;
}
