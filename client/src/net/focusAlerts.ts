import type { FocusEndedMessage, FocusStateMessage } from '@focus-town/shared';
import { sfx } from '../audio/sfx';

/**
 * Tells someone working in another window when their session needs them: a chime, plus a system
 * notification if they allowed those. In front of the game, the panels already say it all.
 */
const away = () => document.visibilityState !== 'visible' || !document.hasFocus();

/** Must be called from a click; asks at most once. */
export function requestFocusAlerts(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** A sound, and a system notification if they're in another window and allowed them. */
export function notifyAway(title: string, body: string, sound: 'chime' | 'pop' = 'chime'): void {
  sfx.play(sound);
  if (away()) notify(title, body, false);
}

function notify(title: string, body: string, chime = true): void {
  if (chime) sfx.play('chime');
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: '/icons/icon-192.png',
    tag: 'hearthwork-focus',
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function alertFocusState(before: FocusStateMessage | null, now: FocusStateMessage): void {
  if (away() && now.awaitingPresence && !before?.awaitingPresence) {
    notify('Still here?', 'Answer in the next few minutes to keep your focus timer going.');
  }
}

export function alertFocusEnded(end: FocusEndedMessage): void {
  if (!away()) return;
  if (end.reason === 'completed' || end.reason === 'table_finished') {
    notify(
      'Focus block finished',
      `${end.verifiedMin} minutes, +${end.coinsEarned} coins. Nice work!`,
    );
  } else if (end.reason === 'missed_beats') {
    notify('Focus session ended', 'Hearthwork lost contact with your timer.');
  }
}
