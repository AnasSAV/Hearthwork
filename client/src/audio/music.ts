import { useSyncExternalStore } from 'react';
import { radio } from './radio';

/**
 * What's playing: the synced Town Radio (procedural, generated in the browser, everyone hears
 * the same thing) or a live YouTube lofi stream. YouTube streams play in the Radio widget's
 * embedded player, which YouTube requires to stay visible (at least 200×200), so picking one
 * also opens that widget.
 */
export interface Station {
  id: string;
  name: string;
  desc: string;
  kind: 'town' | 'youtube';
  videoId?: string;
  color: string;
}

export const STATIONS: readonly Station[] = [
  {
    id: 'town',
    name: 'Town Radio',
    desc: 'Made live in your browser, in sync with everyone',
    kind: 'town',
    color: '#f5b84e',
  },
  {
    id: 'lofigirl',
    name: 'Lofi Girl',
    desc: 'beats to relax/study to · live',
    kind: 'youtube',
    videoId: 'jfKfPfyJRdk',
    color: '#9271d8',
  },
  {
    id: 'sleep',
    name: 'Lofi Sleep',
    desc: 'beats to sleep/chill to · live',
    kind: 'youtube',
    videoId: '28KRPhVzCus',
    color: '#457fb9',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    desc: 'beats to chill/game to · live',
    kind: 'youtube',
    videoId: '4xDzrJKXOOY',
    color: '#ea7b74',
  },
  {
    id: 'chillhop',
    name: 'Chillhop',
    desc: 'jazzy & lofi hip hop · live',
    kind: 'youtube',
    videoId: '5yx6BWlEVcY',
    color: '#79b48c',
  },
];

export interface MusicState {
  stationId: string;
  playing: boolean;
  /** 0..1, shared by every station. */
  volume: number;
}

const KEY = 'focus-town:music';

function load(): MusicState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MusicState>;
    const station = STATIONS.some((s) => s.id === saved.stationId) ? saved.stationId! : 'town';
    const v = Number(saved.volume);
    return {
      stationId: station,
      playing: false,
      volume: Number.isFinite(v) && v >= 0 && v <= 1 ? v : radio.get().volume,
    };
  } catch {
    return { stationId: 'town', playing: false, volume: radio.get().volume };
  }
}

let state = load();
const listeners = new Set<() => void>();
function set(patch: Partial<MusicState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ stationId: state.stationId, volume: state.volume }));
  } catch {
    // Not persisted; fine.
  }
  listeners.forEach((l) => l());
}

export const stationOf = (id: string) => STATIONS.find((s) => s.id === id) ?? STATIONS[0]!;

export const music = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  station: () => stationOf(state.stationId),

  async play(): Promise<void> {
    if (music.station().kind === 'town') await radio.play();
    set({ playing: true });
  },
  stop(): void {
    radio.stop();
    set({ playing: false });
  },
  toggle(): void {
    if (state.playing) music.stop();
    else void music.play();
  },
  async tune(id: string): Promise<void> {
    const wasPlaying = state.playing;
    radio.stop();
    set({ stationId: stationOf(id).id, playing: false });
    if (wasPlaying || id !== 'town') await music.play();
  },
  setVolume(v: number): void {
    radio.setVolume(v);
    set({ volume: v });
  },
};

export function useMusic<T>(select: (s: MusicState) => T): T {
  return useSyncExternalStore(music.subscribe, () => select(state));
}
