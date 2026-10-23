import { hashString, loopingNoise, midiToHz, noiseBuffer, rng } from './engine';

/**
 * A procedural lofi track: jazzy 7th-chord progression on soft keys, a sine bass, swung
 * drums, an occasional pentatonic melody and vinyl crackle. Everything is derived from the
 * seed and the bar number, so any client starting at the same offset hears the same music.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PROGRESSIONS = [
  [1, 4, 0, 5], // ii7  V7  Imaj7 vi7
  [0, 5, 1, 4], // Imaj7 vi7 ii7 V7
  [5, 3, 0, 4], // vi7 IVmaj7 Imaj7 V7
  [3, 2, 1, 0], // IVmaj7 iii7 ii7 Imaj7
  [0, 3, 2, 5], // Imaj7 IVmaj7 iii7 vi7
];
const PENTATONIC = [0, 2, 4, 7, 9];

interface TrackSpec {
  bpm: number;
  root: number;
  progression: number[];
  /** 0..1: how busy the melody is. */
  melody: number;
  /** Bars that drop the drums (breakdowns). */
  breakEvery: number;
}

function spec(seed: string): TrackSpec {
  const r = rng(hashString(seed));
  return {
    bpm: 68 + Math.floor(r() * 16),
    root: 48 + Math.floor(r() * 7),
    progression: PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]!,
    melody: 0.2 + r() * 0.3,
    breakEvery: 8 + 4 * Math.floor(r() * 3),
  };
}

/** Scale-degree 7th chord as MIDI notes. */
function chord(root: number, degree: number): number[] {
  return [0, 2, 4, 6].map((step) => {
    const i = degree + step;
    return root + MAJOR[i % 7]! + 12 * Math.floor(i / 7);
  });
}

export class LofiTrack {
  private readonly spec: TrackSpec;
  private readonly stepDur: number;
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private crackle: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  /** AudioContext time at which the track's step 0 happens. */
  private t0 = 0;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly seed: string,
    private readonly durationSec: number,
  ) {
    this.spec = spec(seed);
    this.stepDur = 60 / this.spec.bpm / 4;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2600;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter.connect(this.out).connect(destination);
  }

  /** Start playing from `offsetSec` into the track. */
  start(offsetSec: number): void {
    const now = this.ctx.currentTime;
    this.t0 = now - offsetSec;
    this.nextStep = Math.ceil(offsetSec / this.stepDur);
    // Fade in (always, so joining mid-track doesn't click), and out before the end.
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + 1.5);
    const end = this.t0 + this.durationSec;
    if (end - 3 > now + 1.5) {
      this.out.gain.setValueAtTime(1, end - 3);
      this.out.gain.linearRampToValueAtTime(0, end);
    }

    // Vinyl hiss.
    this.crackle = loopingNoise(this.ctx);
    const hiss = this.ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 3500;
    hiss.Q.value = 0.6;
    const hissGain = this.ctx.createGain();
    hissGain.gain.value = 0.012;
    this.crackle.connect(hiss).connect(hissGain).connect(this.filter);
    this.crackle.start();

    this.schedule();
    this.timer = setInterval(() => this.schedule(), 80);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.4);
    const crackle = this.crackle;
    setTimeout(() => {
      crackle?.stop();
      this.out.disconnect();
    }, 500);
  }

  /** Schedule every step that starts within the next 0.35 s. */
  private schedule(): void {
    const horizon = this.ctx.currentTime + 0.35;
    const lastStep = Math.floor(this.durationSec / this.stepDur);
    while (this.nextStep <= lastStep) {
      const t = this.stepTime(this.nextStep);
      if (t > horizon) break;
      if (t >= this.ctx.currentTime - 0.01) this.playStep(this.nextStep, t);
      this.nextStep++;
    }
  }

  /** Swing: every second 16th is pushed late. */
  private stepTime(step: number): number {
    const swing = step % 2 === 1 ? this.stepDur * 0.18 : 0;
    return this.t0 + step * this.stepDur + swing;
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const r = rng(hashString(`${this.seed}:${bar}`));
    const sp = this.spec;
    const degree = sp.progression[bar % sp.progression.length]!;
    const notes = chord(sp.root, degree);
    const breakdown = bar % sp.breakEvery === sp.breakEvery - 1;

    if (s === 0) notes.forEach((n, i) => this.keys(n, t + i * 0.018, 0.09, this.stepDur * 14));
    if (s === 8 && r() < 0.5)
      notes.slice(1).forEach((n, i) => this.keys(n, t + i * 0.02, 0.05, this.stepDur * 7));
    if (s === 0 || s === 8 || (s === 10 && r() < 0.4))
      this.bass(notes[0]! - 12, t, s === 0 ? 0.22 : 0.15);

    if (!breakdown) {
      if (s === 0 || s === 10 || (s === 7 && r() < 0.3)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 0) this.hat(t, 0.025 + r() * 0.015);
    }

    // Sparse pentatonic melody on 8th notes.
    if (s % 2 === 0 && r() < sp.melody * (breakdown ? 1.5 : 1)) {
      const pent = PENTATONIC[Math.floor(r() * PENTATONIC.length)]!;
      this.lead(sp.root + 24 + pent, t, this.stepDur * (2 + Math.floor(r() * 3)));
    }
    if (r() < 0.08) this.pop(t + r() * this.stepDur);
  }

  private keys(midi: number, t: number, level: number, length: number): void {
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    for (const [type, detune, mix] of [
      ['triangle', -4, 1],
      ['sine', 5, 0.6],
    ] as const) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToHz(midi);
      osc.detune.value = detune;
      const g = c.createGain();
      g.gain.value = mix;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    gain.connect(this.filter);
  }

  private bass(midi: number, t: number, level: number): void {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(midi);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + this.stepDur * 7);
    osc.connect(gain).connect(this.filter);
    osc.start(t);
    osc.stop(t + this.stepDur * 7 + 0.05);
  }

  private lead(midi: number, t: number, length: number): void {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(midi);
    const vibrato = c.createOscillator();
    vibrato.frequency.value = 5;
    const depth = c.createGain();
    depth.gain.value = 3;
    vibrato.connect(depth).connect(osc.detune);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.045, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(this.filter);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + length + 0.05);
    vibrato.stop(t + length + 0.05);
  }

  private kick(t: number): void {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(this.filter);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private snare(t: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.13, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp).connect(gain).connect(this.filter);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  private hat(t: number, level: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const gain = c.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(gain).connect(this.filter);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  /** A vinyl pop. */
  private pop(t: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    src.connect(gain).connect(this.filter);
    src.start(t, Math.random());
    src.stop(t + 0.015);
  }
}
