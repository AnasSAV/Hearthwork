import {
  ClientMsg,
  type FocusBeatMessage,
  type FocusBlock,
  type FocusStartMessage,
} from '@focus-town/shared';

/**
 * React → game-server actions. Whichever world scene is active (town or a house) plugs in its
 * room's `send` while connected; React components call these without knowing about Colyseus.
 */
type Send = (type: string, payload?: unknown) => void;

let send: Send | null = null;

export function attachRoomSender(fn: Send | null): void {
  send = fn;
}

/** Send any client message to the current room (no-op while disconnected). */
export function sendToRoom(type: string, payload?: unknown): void {
  send?.(type, payload);
}

export const roomActions = {
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
  /** Ask the house room to re-read the house (owner only; after save/upgrade/settings). */
  reloadHouse(): void {
    send?.(ClientMsg.HouseReload);
  },
};
