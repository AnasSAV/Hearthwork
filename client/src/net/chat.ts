import { useSyncExternalStore } from 'react';
import { ClientMsg, type ChatMessage, type WhisperMessage } from '@focus-town/shared';
import { sendToRoom } from './roomBridge';

const MUTED_KEY = 'focus-town:muted';
const MAX_SHOWN = 100;

/** Someone you can whisper to (session ids are per room). */
export interface Partner {
  sessionId: string;
  name: string;
}

export interface Conversation {
  partner: Partner;
  messages: WhisperMessage[];
  unread: number;
}

export interface ChatState {
  messages: ChatMessage[];
  muted: ReadonlySet<string>;
  notice: string | null;
  /** Players currently within whisper range. */
  nearby: Partner[];
  /** Private conversations in this room, by partner session id. */
  conversations: Record<string, Conversation>;
  /** 'room', or the partner session id of an open whisper. */
  tab: string;
  /** Bumped to ask the chat input to take focus. */
  focusRequest: number;
}

function loadMuted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let mySessionId = '';
let state: ChatState = {
  messages: [],
  muted: loadMuted(),
  notice: null,
  nearby: [],
  conversations: {},
  tab: 'room',
  focusRequest: 0,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<ChatState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/**
 * Room chat plus private whispers to nearby players. Muting is per player and stays in this
 * browser; it hides both their room messages and their whispers.
 */
export const chat = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  isMuted: (userId: string) => state.muted.has(userId),

  /** New room: replace the log with its recent history and drop old whispers. */
  reset(history: ChatMessage[] = [], sessionId = ''): void {
    mySessionId = sessionId;
    set({
      messages: history.slice(-MAX_SHOWN),
      notice: null,
      nearby: [],
      conversations: {},
      tab: 'room',
    });
  },
  setMe(sessionId: string): void {
    mySessionId = sessionId;
  },
  add(message: ChatMessage): void {
    set({ messages: [...state.messages, message].slice(-MAX_SHOWN) });
  },
  notice(message: string | null): void {
    set({ notice: message });
  },

  /** Send on the current tab: room chat or a whisper. */
  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (state.tab === 'room') sendToRoom(ClientMsg.Chat, { text: trimmed });
    else sendToRoom(ClientMsg.Whisper, { to: state.tab, text: trimmed });
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

  // --- Whispers -------------------------------------------------------------------------------

  setNearby(nearby: Partner[]): void {
    const same =
      nearby.length === state.nearby.length &&
      nearby.every((p, i) => p.sessionId === state.nearby[i]?.sessionId);
    if (!same) set({ nearby });
  },
  inRange: (sessionId: string) => state.nearby.some((p) => p.sessionId === sessionId),

  /** Open (or switch to) a private conversation and focus the input. */
  openWhisper(partner: Partner): void {
    const existing = state.conversations[partner.sessionId];
    set({
      conversations: {
        ...state.conversations,
        [partner.sessionId]: existing
          ? { ...existing, unread: 0 }
          : { partner, messages: [], unread: 0 },
      },
      tab: partner.sessionId,
      focusRequest: state.focusRequest + 1,
    });
  },
  closeWhisper(sessionId: string): void {
    const conversations = Object.fromEntries(
      Object.entries(state.conversations).filter(([id]) => id !== sessionId),
    );
    set({ conversations, tab: state.tab === sessionId ? 'room' : state.tab });
  },
  setTab(tab: string): void {
    const c = state.conversations[tab];
    set({
      tab,
      conversations: c
        ? { ...state.conversations, [tab]: { ...c, unread: 0 } }
        : state.conversations,
    });
  },
  addWhisper(m: WhisperMessage): void {
    const mine = m.sessionId === mySessionId;
    const partner: Partner = mine
      ? { sessionId: m.to.sessionId, name: m.to.name }
      : { sessionId: m.sessionId, name: m.name };
    const c = state.conversations[partner.sessionId] ?? { partner, messages: [], unread: 0 };
    const unread = !mine && state.tab !== partner.sessionId ? c.unread + 1 : c.unread;
    set({
      conversations: {
        ...state.conversations,
        [partner.sessionId]: { ...c, messages: [...c.messages, m].slice(-MAX_SHOWN), unread },
      },
    });
  },
};

export function useChat<T>(select: (s: ChatState) => T): T {
  return useSyncExternalStore(chat.subscribe, () => select(state));
}
