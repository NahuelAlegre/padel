/**
 * The building blocks of every sound in the game. Nothing here is recorded:
 * each sound is a small recipe of these pieces, rendered into a buffer once,
 * after the first frame, and then played as many times as it is needed.
 *
 * Everything works on plain Float32Arrays and a seeded generator, so a sound
 * is the same on every device and can be rendered (and tested) in Node.
 */
import { Rng } from '../../core/rng';

export type Signal = Float32Array;

export const TAU = Math.PI * 2;

export function samples(sr: number, seconds: number): Signal {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function db(gainDb: number): number {
  return Math.pow(10, gainDb / 20);
}

/** Semitones to a frequency ratio. */
export function st(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Smoothstep between 0 and 1. */
export function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** A value spread around `x` by up to `spread` (a fraction), from the generator. */
export function vary(rng: Rng, x: number, spread: number): number {
  return x * (1 + (rng.next() * 2 - 1) * spread);
}

// ---------------------------------------------------------------- mixing

/** Adds `src` into `dst` from sample `at`, scaled by `gain`. */
export function mixInto(dst: Signal, src: Signal, at = 0, gain = 1): void {
  const start = Math.max(0, Math.round(at));
  const n = Math.min(src.length, dst.length - start);
  for (let i = 0; i < n; i++) dst[start + i]! += src[i]! * gain;
}

export function scale(x: Signal, gain: number): Signal {
  for (let i = 0; i < x.length; i++) x[i]! *= gain;
  return x;
}

export function peak(x: Signal): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function rms(x: Signal, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Scales `x` so that its peak is `target`. */
export function normalize(x: Signal, target = 0.9): Signal {
  const p = peak(x);
  return p > 0 ? scale(x, target / p) : x;
}

/** Short fades at both ends, so a buffer never starts or stops with a click. */
export function fadeEdges(x: Signal, sr: number, inMs = 0.5, outMs = 8): Signal {
  const a = Math.min(x.length, Math.round((sr * inMs) / 1000));
  const b = Math.min(x.length, Math.round((sr * outMs) / 1000));
  for (let i = 0; i < a; i++) x[i]! *= i / a;
  for (let i = 0; i < b; i++) x[x.length - 1 - i]! *= i / b;
  return x;
}

/** Cuts the silent tail: everything after the last sample above `floor`. */
export function trim(x: Signal, floor = 1e-4): Signal {
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]!) < floor) end--;
  return x.subarray(0, Math.min(x.length, end + 16)).slice();
}

/** A gentle saturation for the loud moments: round, never a hard clip. */
export function soft(x: Signal, drive = 1): Signal {
  if (drive <= 0) return x;
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * drive) / k;
  return x;
}

// ---------------------------------------------------------------- noise

export function white(rng: Rng, n: number, gain = 1): Signal {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng.next() * 2 - 1) * gain;
  return out;
}

/** Pink noise (Paul Kellet's economy filter): equal energy per octave, like wind and crowds. */
export function pink(rng: Rng, n: number, gain = 1): Signal {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18 * gain;
  }
  return out;
}

/** Brown noise: a random walk, for rumble and the low body of wind. */
export function brown(rng: Rng, n: number, gain = 1): Signal {
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.998 * y + (rng.next() * 2 - 1) * 0.04;
    out[i] = y * 2.5 * gain;
  }
  return out;
}

/**
 * A slow random curve between 0 and 1 for gusts, crowds and moods: smooth
 * noise made of points `every` seconds apart, joined with cosine curves.
 */
export function drift(rng: Rng, sr: number, n: number, every: number, lo = 0, hi = 1): Signal {
  const out = new Float32Array(n);
  const step = Math.max(1, Math.round(every * sr));
  let a = rng.range(lo, hi);
  let b = rng.range(lo, hi);
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) {
      a = b;
      b = rng.range(lo, hi);
    }
    const t = (1 - Math.cos((Math.PI * k) / step)) / 2;
    out[i] = a + (b - a) * t;
  }
  return out;
}

// ---------------------------------------------------------------- filters

/**
 * A biquad from the Audio EQ Cookbook (Robert Bristow-Johnson), the same
 * shapes as Web Audio's BiquadFilterNode.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly sr: number,
    type: BiquadType,
    freq: number,
    q = Math.SQRT1_2,
    gainDb = 0,
  ) {
    this.set(type, freq, q, gainDb);
  }

  set(type: BiquadType, freq: number, q = Math.SQRT1_2, gainDb = 0): this {
    const f = clamp(freq, 5, this.sr * 0.49);
    const w = (TAU * f) / this.sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(1e-4, q));
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        // Constant 0 dB peak gain.
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1;
        b1 = -2 * cw;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  /** Filters `x` in place. */
  run(x: Signal): Signal {
    for (let i = 0; i < x.length; i++) x[i] = this.tick(x[i]!);
    return x;
  }
}

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'lowshelf' | 'highshelf';

export function filter(sr: number, x: Signal, type: BiquadType, freq: number, q?: number, gainDb?: number): Signal {
  return new Biquad(sr, type, freq, q, gainDb).run(x);
}

/** One-pole lowpass with a cutoff in Hz: soft, no resonance. */
export class OnePole {
  private a = 0;
  private y = 0;
  constructor(
    private readonly sr: number,
    cutoff: number,
  ) {
    this.cutoff(cutoff);
  }
  cutoff(hz: number): void {
    this.a = Math.exp((-TAU * clamp(hz, 1, this.sr / 2)) / this.sr);
  }
  tick(x: number): number {
    this.y = x + this.a * (this.y - x);
    return this.y;
  }
}

/**
 * A two-pole resonator in the style of Klatt's formant synthesizer: unity
 * gain at 0 Hz, a peak at `freq` with bandwidth `bw`. Frequency and
 * bandwidth can change on every sample.
 */
export class Resonator {
  private a = 1;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly sr: number) {}

  set(freq: number, bw: number): void {
    const T = 1 / this.sr;
    const f = clamp(freq, 1, this.sr * 0.47);
    this.c = -Math.exp(-2 * Math.PI * bw * T);
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(TAU * f * T);
    this.a = 1 - this.b - this.c;
  }

  tick(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** The inverse of a resonator: a dip (anti-formant), for the nasal zero of /m/ and /n/. */
export class AntiResonator {
  private a = 1;
  private b = 0;
  private c = 0;
  private x1 = 0;
  private x2 = 0;
  constructor(private readonly sr: number) {}

  set(freq: number, bw: number): void {
    const T = 1 / this.sr;
    const f = clamp(freq, 1, this.sr * 0.47);
    const c = -Math.exp(-2 * Math.PI * bw * T);
    const b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(TAU * f * T);
    const a = 1 - b - c;
    this.a = 1 / a;
    this.b = -b / a;
    this.c = -c / a;
  }

  tick(x: number): number {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2;
    this.x2 = this.x1;
    this.x1 = x;
    return y;
  }
}

// ---------------------------------------------------------------- impacts

/** One mode of something that rings when it is struck. */
export interface Mode {
  /** Hz. */
  f: number;
  /** Seconds for the mode to fall to 1/e of its amplitude. */
  tau: number;
  /** Amplitude, before the shape of the contact is applied. */
  g: number;
}

/**
 * How much a contact of `contact` seconds excites a frequency: a soft contact
 * (a long one) excites the high modes less. This is what makes a hard hit
 * brighter and not only louder. Smooth, with no nulls, falling 6 dB per
 * octave: with 3 ms of contact 1 kHz loses 2 dB, with 7.5 ms it loses 6.
 * (The measured contact of a ball is longer than this suggests, but what is
 * heard is the radiated sound, which favours the highs.)
 */
export function contactShape(f: number, contact: number): number {
  const x = (f * contact) / 4.2;
  return 1 / Math.sqrt(1 + x * x);
}

/**
 * Rings a set of modes, all struck at time `at` (samples) by a contact of
 * `contact` seconds. Each mode starts with a short rise as long as the
 * contact, so the attack is never a digital click, and keeps a random phase.
 */
export function ring(
  out: Signal,
  sr: number,
  rng: Rng,
  modes: readonly Mode[],
  contact: number,
  at = 0,
  gain = 1,
): void {
  const rise = Math.max(2, Math.round(contact * sr * 0.5));
  for (const m of modes) {
    if (m.f >= sr * 0.45) continue;
    const amp = m.g * gain * contactShape(m.f, contact);
    if (Math.abs(amp) < 1e-5) continue;
    const decay = Math.exp(-1 / (m.tau * sr));
    const w = (TAU * m.f) / sr;
    // A recursive oscillator: cheaper than calling sin on every sample.
    const phase = rng.next() * 0.6 - 0.3;
    let s1 = Math.sin(phase);
    let s0 = Math.sin(phase - w);
    const k = 2 * Math.cos(w);
    let env = amp;
    const len = Math.min(out.length - at, Math.ceil(m.tau * sr * 7));
    for (let i = 0; i < len; i++) {
      const r = i < rise ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rise) : 1;
      out[at + i]! += s1 * env * r;
      const s2 = k * s1 - s0;
      s0 = s1;
      s1 = s2;
      env *= decay;
    }
  }
}

/** A cluster of `count` modes spread around `f` (±`spread`), for surfaces too complex to list mode by mode. */
export function cluster(
  rng: Rng,
  count: number,
  f: number,
  spread: number,
  tau: number,
  g: number,
  tauSpread = 0.3,
): Mode[] {
  const modes: Mode[] = [];
  for (let i = 0; i < count; i++) {
    modes.push({
      f: f * Math.pow(2, (rng.next() * 2 - 1) * spread),
      tau: vary(rng, tau, tauSpread),
      g: (g / Math.sqrt(count)) * (0.4 + rng.next() * 0.9) * (rng.next() < 0.5 ? -1 : 1),
    });
  }
  return modes;
}

/** A burst of filtered noise: the crack of a hit, the scrape of sand, a breath. */
export function burst(
  sr: number,
  rng: Rng,
  seconds: number,
  type: BiquadType,
  freq: number,
  q: number,
  attack: number,
  decay: number,
): Signal {
  const x = white(rng, Math.ceil(sr * seconds));
  filter(sr, x, type, freq, q);
  const a = Math.max(1, attack * sr);
  const d = Math.max(1e-4, decay * sr);
  for (let i = 0; i < x.length; i++) {
    const env = i < a ? i / a : Math.exp(-(i - a) / d);
    x[i]! *= env;
  }
  return x;
}

// ---------------------------------------------------------------- space

/**
 * A small feedback delay network: the court's own air. Eight delay lines
 * mixed by a Hadamard matrix, each with a lowpass in the loop so the tail
 * darkens as it dies, as it does outdoors. Returns a stereo pair.
 */
export interface RoomOptions {
  /** Seconds for the tail to fall 60 dB. */
  rt60: number;
  /** Size of the space: scales the delay lengths. */
  size: number;
  /** Hz above which the tail loses energy faster. */
  damp: number;
  /** Seconds before the tail starts. */
  predelay: number;
}

const ROOM_DELAYS = [0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0571, 0.0617, 0.0683];

export function room(sr: number, input: Signal, opts: RoomOptions, tail = opts.rt60): [Signal, Signal] {
  return finish(roomSteps(sr, input, opts, tail));
}

/** Samples a long piece of work does between pauses: a couple of milliseconds on a phone. */
export const STEP_SAMPLES = 8192;

/**
 * Work that can stop and go on: each `yield` is a moment where the page may
 * draw a frame or answer a touch. `finish` runs it straight through.
 */
export type Steps<T> = Generator<void, T, void>;

export function finish<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** `room`, pausing every `STEP_SAMPLES` samples. */
export function* roomSteps(sr: number, input: Signal, opts: RoomOptions, tail = opts.rt60): Steps<[Signal, Signal]> {
  const n = input.length + Math.ceil(tail * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const lines = ROOM_DELAYS.map((d) => new Float32Array(Math.max(1, Math.round(d * opts.size * sr))));
  const idx = new Array<number>(8).fill(0);
  const gains = lines.map((line) => Math.pow(10, (-3 * line.length) / (opts.rt60 * sr)));
  const lp = lines.map(() => new OnePole(sr, opts.damp));
  const pre = Math.round(opts.predelay * sr);
  const outs = new Float64Array(8);
  const mixed = new Float64Array(8);
  const norm = 1 / Math.sqrt(8);
  // Each line hears the input with its own sign, so the lines start apart.
  const signs = [1, -1, 1, 1, -1, 1, -1, -1];
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % STEP_SAMPLES === 0) yield;
    const x = i - pre >= 0 && i - pre < input.length ? input[i - pre]! : 0;
    for (let j = 0; j < 8; j++) outs[j] = lines[j]![idx[j]!]!;
    // Fast Hadamard transform of order 8, scaled to stay unitary.
    const a0 = outs[0]! + outs[1]!, a1 = outs[0]! - outs[1]!;
    const a2 = outs[2]! + outs[3]!, a3 = outs[2]! - outs[3]!;
    const a4 = outs[4]! + outs[5]!, a5 = outs[4]! - outs[5]!;
    const a6 = outs[6]! + outs[7]!, a7 = outs[6]! - outs[7]!;
    const b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3;
    const b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
    mixed[0] = b0 + b4;
    mixed[1] = b1 + b5;
    mixed[2] = b2 + b6;
    mixed[3] = b3 + b7;
    mixed[4] = b0 - b4;
    mixed[5] = b1 - b5;
    mixed[6] = b2 - b6;
    mixed[7] = b3 - b7;
    for (let j = 0; j < 8; j++) {
      const line = lines[j]!;
      const fb = lp[j]!.tick(mixed[j]! * norm * gains[j]!);
      line[idx[j]!] = fb + x * 0.35 * signs[j]!;
      idx[j] = (idx[j]! + 1) % line.length;
    }
    left[i] = (outs[0]! - outs[2]! + outs[4]! - outs[6]!) * 0.5;
    right[i] = (outs[1]! - outs[3]! + outs[5]! - outs[7]!) * 0.5;
  }
  return [left, right];
}

/** A copy of `x`, `extra` seconds longer, for effects with a tail. */
export function padded(x: Signal, sr: number, extra: number): Signal {
  const out = new Float32Array(x.length + Math.ceil(extra * sr));
  out.set(x);
  return out;
}

/** Equal-power crossfade of the end of `x` into its start, so it loops without a seam. Returns the loop. */
export function seamless(x: Signal, sr: number, fade: number): Signal {
  const f = Math.min(Math.floor(x.length / 3), Math.round(fade * sr));
  const len = x.length - f;
  const out = x.slice(0, len);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = x[i]! * Math.sin((Math.PI / 2) * t) + x[len + i]! * Math.cos((Math.PI / 2) * t);
  }
  return out;
}

export { Rng };
