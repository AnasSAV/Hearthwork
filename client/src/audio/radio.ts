import { useSyncExternalStore } from 'react';
import { onAir, type RadioPlaylist, type RadioTrack } from '@focus-town/shared';
import { serverNow } from '../net/clock';
import { audioContext, unlockAudio } from './engine';
import { LofiTrack } from './lofi';

/**
 * Synced radio without a streaming server. `public/radio/playlist.json` lists tracks with their
 * durations and the moment the station "started". Every client computes the same position:
 * `(serverNow - startedAt) mod playlistLength`, then plays that track from that offset.
 *
 * Tracks are either real audio files (`src: "radio/track.mp3"`, must be license-cleared) or
 * procedural (`src: "synth:<seed>"`), generated live in the browser and therefore identical
 * for everyone without any download.
 */
type Track = RadioTrack;

export interface RadioState {
  playing: boolean;
  volume: number;
  track: Track | null;
  error: string | null;
}

const SETTINGS_KEY = 'focus-town:radio';

function loadVolume(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').volume);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
}

let state: RadioState = { playing: false, volume: loadVolume(), track: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<RadioState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let playlist: RadioPlaylist | null = null;
let gain: GainNode | null = null;
let current: { stop(): void } | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;

async function loadPlaylist(): Promise<RadioPlaylist> {
  if (playlist) return playlist;
  const res = await fetch('/radio/playlist.json');
  if (!res.ok) throw new Error('Radio playlist not found');
  playlist = (await res.json()) as RadioPlaylist;
  if (!playlist.tracks.length) throw new Error('Radio playlist is empty');
  return playlist;
}

function playFile(track: Track, offsetSec: number, out: AudioNode): { stop(): void } {
  const el = new Audio(track.src.startsWith('/') ? track.src : `/${track.src}`);
  el.crossOrigin = 'anonymous';
  const node = audioContext().createMediaElementSource(el);
  node.connect(out);
  el.addEventListener('loadedmetadata', () => (el.currentTime = offsetSec), { once: true });
  void el.play().catch(() => set({ error: 'Could not play this track.' }));
  return {
    stop: () => {
      el.pause();
      node.disconnect();
    },
  };
}

async function tune(): Promise<void> {
  const p = await loadPlaylist();
  const ctx = audioContext();
  if (!gain) {
    gain = ctx.createGain();
    gain.connect(ctx.destination);
  }
  gain.gain.value = state.volume;
  current?.stop();
  const { index, offsetSec } = onAir(p, serverNow());
  const track = p.tracks[index]!;
  current = track.src.startsWith('synth:')
    ? (() => {
        const lofi = new LofiTrack(ctx, gain, track.src.slice(6), track.durationSec);
        lofi.start(offsetSec);
        return lofi;
      })()
    : playFile(track, offsetSec, gain);
  set({ track, error: null });
  if (advanceTimer) clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => void tune(), (track.durationSec - offsetSec) * 1000 + 50);
}

export const radio = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async play(): Promise<void> {
    try {
      await unlockAudio();
      await tune();
      set({ playing: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  stop(): void {
    current?.stop();
    current = null;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
    set({ playing: false });
  },
  setVolume(volume: number): void {
    if (gain) gain.gain.value = volume;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume }));
    } catch {
      // Not persisted; fine.
    }
    set({ volume });
  },
};

export function useRadio<T>(select: (s: RadioState) => T): T {
  return useSyncExternalStore(radio.subscribe, () => select(state));
}
