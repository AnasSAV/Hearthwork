/**
 * Shared WebAudio plumbing: one AudioContext (created/resumed on a user gesture, as browsers
 * require), a noise buffer, and small deterministic random helpers for the procedural audio.
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** Call from a click handler: browsers only start audio after a user gesture. */
export async function unlockAudio(): Promise<AudioContext> {
  const c = audioContext();
  if (c.state !== 'running') await c.resume();
  return c;
}

/** 2 seconds of white noise, shared by every noise-based sound. */
export function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

export function loopingNoise(c: AudioContext): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  return src;
}

/** Deterministic PRNG (mulberry32) so every client generates identical music. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
