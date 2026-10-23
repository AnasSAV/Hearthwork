import {
  ClientMsg,
  type FocusBeatMessage,
  type FocusBlock,
  type FocusStartMessage,
} from '@focus-town/shared';

/**
 * React → game-server actions. The Town scene plugs in its room's `send` while connected;
 * React components call these without knowing about Colyseus.
 */
type Send = (type: string, payload?: unknown) => void;

let send: Send | null = null;

export function attachTownSender(fn: Send | null): void {
  send = fn;
}

export const townActions = {
  startFocus(deskId: string, plannedMin: FocusBlock | null, audioOnly: boolean): void {
    const msg: FocusStartMessage = { deskId, plannedMin, audioOnly };
    send?.(ClientMsg.FocusStart, msg);
  },
  beat(msg: FocusBeatMessage): void {
    send?.(ClientMsg.FocusBeat, msg);
  },
  confirmPresence(): void {
    send?.(ClientMsg.FocusConfirm);
  },
  endFocus(): void {
    send?.(ClientMsg.FocusEnd);
  },
};
