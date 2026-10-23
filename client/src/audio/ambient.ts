import { useSyncExternalStore } from 'react';
import { audioContext, loopingNoise, unlockAudio } from './engine';

/**
 * Ambient soundscapes, synthesised (no audio files): rain, fireplace, birds and wind. Each has
 * its own volume; settings stay in this browser. Not synced: everyone picks their own mix.
 */
export const AMBIENT_SOUNDS = ['rain', 'fire', 'birds', 'wind'] as const;
export type AmbientSound = (typeof AMBIENT_SOUNDS)[number];

export const AMBIENT_LABEL: Record<AmbientSound, string> = {
  rain: 'Rain',
  fire: 'Fireplace',
  birds: 'Birds',
  wind: 'Wind',
};

type Volumes = Record<AmbientSound, number>;

const KEY = 'focus-town:ambient';

function loadVolumes(): Volumes {
  const zero: Volumes = { rain: 0, fire: 0, birds: 0, wind: 0 };
  try {
    return { ...zero, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Volumes>) };
  } catch {
    return zero;
  }
}

let volumes: Volumes = loadVolumes();
const listeners = new Set<() => void>();

interface Voice {
  gain: GainNode;
  stop(): void;
}
const voices = new Map<AmbientSound, Voice>();

function makeRain(ctx: AudioContext, out: AudioNode): () => void {
  const src = loopingNoise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 600;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  // Slow gusts.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const depth = ctx.createGain();
  depth.gain.value = 0.15;
  lfo.connect(depth).connect(g.gain);
  src.connect(hp).connect(lp).connect(g).connect(out);
  src.start();
  lfo.start();
  return () => {
    src.stop();
    lfo.stop();
  };
}

function makeFire(ctx: AudioContext, out: AudioNode): () => void {
  const src = loopingNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 350;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  src.connect(lp).connect(g).connect(out);
  src.start();
  let alive = true;
  const crackle = () => {
    if (!alive) return;
    const t = ctx.currentTime;
    const pop = loopingNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 2500;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.25 + Math.random() * 0.3, t);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.04);
    pop.connect(bp).connect(pg).connect(out);
    pop.start(t, Math.random());
    pop.stop(t + 0.08);
    setTimeout(crackle, 60 + Math.random() * 400);
  };
  crackle();
  return () => {
    alive = false;
    src.stop();
  };
}

function makeBirds(ctx: AudioContext, out: AudioNode): () => void {
  let alive = true;
  const song = () => {
    if (!alive) return;
    let t = ctx.currentTime + 0.05;
    const base = 2200 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const len = 0.06 + Math.random() * 0.08;
      osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + len + 0.02);
      t += len + 0.03 + Math.random() * 0.06;
    }
    setTimeout(song, 1500 + Math.random() * 5000);
  };
  song();
  return () => {
    alive = false;
  };
}

function makeWind(ctx: AudioContext, out: AudioNode): () => void {
  const src = loopingNoise(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  lp.Q.value = 3;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const depth = ctx.createGain();
  depth.gain.value = 300;
  lfo.connect(depth).connect(lp.frequency);
  const g = ctx.createGain();
  g.gain.value = 0.6;
  src.connect(lp).connect(g).connect(out);
  src.start();
  lfo.start();
  return () => {
    src.stop();
    lfo.stop();
  };
}

const MAKERS: Record<AmbientSound, (ctx: AudioContext, out: AudioNode) => () => void> = {
  rain: makeRain,
  fire: makeFire,
  birds: makeBirds,
  wind: makeWind,
};

function apply(sound: AmbientSound): void {
  const level = volumes[sound];
  const voice = voices.get(sound);
  if (level <= 0) {
    voice?.stop();
    voices.delete(sound);
    return;
  }
  if (voice) {
    voice.gain.gain.value = level;
    return;
  }
  const ctx = audioContext();
  const gain = ctx.createGain();
  gain.gain.value = level;
  gain.connect(ctx.destination);
  const stop = MAKERS[sound](ctx, gain);
  voices.set(sound, {
    gain,
    stop: () => {
      stop();
      gain.disconnect();
    },
  });
}

export const ambient = {
  get: () => volumes,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  async setVolume(sound: AmbientSound, level: number): Promise<void> {
    await unlockAudio();
    volumes = { ...volumes, [sound]: level };
    try {
      localStorage.setItem(KEY, JSON.stringify(volumes));
    } catch {
      // Not persisted; fine.
    }
    apply(sound);
    listeners.forEach((l) => l());
  },
  /** Restart saved sounds (needs a user gesture first, e.g. the panel opening). */
  async resume(): Promise<void> {
    await unlockAudio();
    for (const s of AMBIENT_SOUNDS) apply(s);
  },
  stopAll(): void {
    for (const v of voices.values()) v.stop();
    voices.clear();
  },
};

export function useAmbient(): Volumes {
  return useSyncExternalStore(ambient.subscribe, () => volumes);
}
