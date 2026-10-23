import { useSyncExternalStore } from 'react';
import { ClientMsg, type ChatMessage } from '@focus-town/shared';
import { sendToRoom } from './roomBridge';

const MUTED_KEY = 'focus-town:muted';
const MAX_SHOWN = 100;

export interface ChatState {
  messages: ChatMessage[];
  muted: ReadonlySet<string>;
  notice: string | null;
}

function loadMuted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let state: ChatState = { messages: [], muted: loadMuted(), notice: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<ChatState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Chat for the current room. Muting is per player and stays in this browser. */
export const chat = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  isMuted: (userId: string) => state.muted.has(userId),
  /** Replace the log (joining a room delivers its recent history). */
  reset(history: ChatMessage[] = []): void {
    set({ messages: history.slice(-MAX_SHOWN), notice: null });
  },
  add(message: ChatMessage): void {
    set({ messages: [...state.messages, message].slice(-MAX_SHOWN) });
  },
  notice(message: string | null): void {
    set({ notice: message });
  },
  send(text: string): void {
    const trimmed = text.trim();
    if (trimmed) sendToRoom(ClientMsg.Chat, { text: trimmed });
  },
  report(messageId: string): void {
    sendToRoom(ClientMsg.ChatReport, { messageId });
  },
  toggleMute(userId: string): void {
    const muted = new Set(state.muted);
    if (muted.has(userId)) muted.delete(userId);
    else muted.add(userId);
    try {
      localStorage.setItem(MUTED_KEY, JSON.stringify([...muted]));
    } catch {
      // Storage unavailable: the mute still applies for this page.
    }
    set({ muted });
  },
};

export function useChat<T>(select: (s: ChatState) => T): T {
  return useSyncExternalStore(chat.subscribe, () => select(state));
}
