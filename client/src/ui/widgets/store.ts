import { useSyncExternalStore } from 'react';

/**
 * Focus widgets (clock, Pomodoro, radio, todo, notes) floating over the game. Which ones are
 * open and where they sit is a per-browser preference (localStorage), as are the todo list and
 * notes; nothing here touches coins or verified time.
 */
export type WidgetType = 'clock' | 'pomodoro' | 'radio' | 'todo' | 'notes';

export interface Widget {
  id: string;
  type: WidgetType;
  /** e.g. clock face: 'digital' | 'digital-seconds' | 'analog' | 'railway'. */
  variant: string;
  /** Top-left corner in px; null = stacked in the default column. */
  x: number | null;
  y: number | null;
}

interface WidgetState {
  widgets: Widget[];
}

const KEY = 'focus-town:widgets';

function load(): WidgetState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<WidgetState>;
    return { widgets: Array.isArray(saved.widgets) ? saved.widgets.slice(0, 12) : [] };
  } catch {
    return { widgets: [] };
  }
}

let state = load();
const listeners = new Set<() => void>();
function set(next: WidgetState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Not persisted; fine.
  }
  listeners.forEach((l) => l());
}

export const widgets = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  add(type: WidgetType, variant = 'default'): void {
    // One radio is enough: re-adding just changes nothing.
    if (type === 'radio' && state.widgets.some((w) => w.type === 'radio')) return;
    const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    set({ widgets: [...state.widgets, { id, type, variant, x: null, y: null }] });
  },
  has: (type: WidgetType) => state.widgets.some((w) => w.type === type),
  remove(id: string): void {
    set({ widgets: state.widgets.filter((w) => w.id !== id) });
  },
  move(id: string, x: number, y: number): void {
    set({ widgets: state.widgets.map((w) => (w.id === id ? { ...w, x, y } : w)) });
  },
  setVariant(id: string, variant: string): void {
    set({ widgets: state.widgets.map((w) => (w.id === id ? { ...w, variant } : w)) });
  },
};

export function useWidgets(): Widget[] {
  return useSyncExternalStore(widgets.subscribe, () => state.widgets);
}

/** A small persisted value (todo items, notes text) per widget id. */
export function loadValue<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`focus-town:w:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveValue(key: string, value: unknown): void {
  try {
    localStorage.setItem(`focus-town:w:${key}`, JSON.stringify(value));
  } catch {
    // Not persisted; fine.
  }
}
