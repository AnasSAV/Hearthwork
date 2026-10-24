import { useSyncExternalStore } from 'react';
import { audioContext, noiseBuffer } from './engine';

/**
 * Little interface sounds, synthesized on the spot (no files): soft plucks for clicks and
 * panels, a bright arpeggio for coins, a bubble pop for emotes, a whoosh for travelling and a
 * chime for timers. Volume is a per-browser preference.
 */
export type Sfx = 'click' | 'open' | 'close' | 'coin' | 'pop' | 'whoosh' | 'chime' | 'error';

const KEY = 'focus-town:sfx';

function loadVolume(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(KEY) ?? '{}').volume);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
  } catch {
    return 0.5;
  }
}

let volume = loadVolume();
const listeners = new Set<() => void>();

function tone(
  ctx: AudioContext,
  out: AudioNode,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'triangle',
  peak = 0.25,
): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export const sfx = {
  volume: () => volume,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setVolume(v: number): void {
    volume = v;
    try {
      localStorage.setItem(KEY, JSON.stringify({ volume: v }));
    } catch {
      // Not persisted; fine.
    }
    listeners.forEach((l) => l());
  },

  play(name: Sfx): void {
    if (volume <= 0) return;
    let ctx: AudioContext;
    try {
      ctx = audioContext();
    } catch {
      return;
    }
    // Browsers keep audio suspended until a user gesture; sounds before then are skipped.
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      return;
    }
    const out = ctx.createGain();
    out.gain.value = volume * 0.6;
    out.connect(ctx.destination);
    const t = ctx.currentTime;
    switch (name) {
      case 'click':
        tone(ctx, out, 660, t, 0.06, 'triangle', 0.18);
        break;
      case 'open':
        tone(ctx, out, 523, t, 0.09);
        tone(ctx, out, 784, t + 0.06, 0.12);
        break;
      case 'close':
        tone(ctx, out, 659, t, 0.08);
        tone(ctx, out, 440, t + 0.05, 0.1);
        break;
      case 'coin':
        [988, 1319, 1568].forEach((f, i) => tone(ctx, out, f, t + i * 0.06, 0.16, 'square', 0.08));
        break;
      case 'pop': {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + 0.08);
        env.gain.setValueAtTime(0.25, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.connect(env).connect(out);
        osc.start(t);
        osc.stop(t + 0.14);
        break;
      }
      case 'whoosh': {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
        filter.frequency.exponentialRampToValueAtTime(500, t + 0.7);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.35, t + 0.2);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        src.connect(filter).connect(env).connect(out);
        src.start(t);
        src.stop(t + 0.8);
        break;
      }
      case 'chime':
        [784, 988, 1175, 1568].forEach((f, i) => tone(ctx, out, f, t + i * 0.12, 0.9, 'sine', 0.2));
        break;
      case 'error':
        tone(ctx, out, 220, t, 0.12, 'square', 0.08);
        tone(ctx, out, 180, t + 0.1, 0.16, 'square', 0.08);
        break;
    }
    setTimeout(() => out.disconnect(), 1500);
  },
};

export function useSfxVolume(): number {
  return useSyncExternalStore(sfx.subscribe, () => volume);
}
