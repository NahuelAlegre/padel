/**
 * The club at dusk, around the court: wind in the plane trees, the birds of
 * a Buenos Aires evening, a glass at the buffet and, now and then, a rally on
 * the next court. No human voices: synthesized, they sounded artificial.
 *
 * It is made of two layers. The bed (wind, leaves and the far hum of the
 * city) is a long buffer that loops without a seam. The events (a bird, the
 * next court, a glass) are short buffers dropped at random moments, so the
 * whole never repeats and nobody hears where the loop turns.
 */
import { Rng } from '../../core/rng';
import { bounce, glass, GLASS_STYLES, racketHit, RACKET_STYLES, TURF_STYLES } from './impacts';
import { brown, drift, filter, finish, mixInto, normalize, pink, ring, seamless, type Mode, type Signal, type Steps, vary, white } from './dsp';

export interface AmbienceStyle {
  /** The low body of the wind. */
  wind: number;
  /** Leaves: the wind in the plane trees. */
  leaves: number;
  /** The city far away, a low hum under everything. */
  city: number;
  /** Events per minute of each kind. */
  birds: number;
  rally: number;
  clinks: number;
  /** Which birds: weights of thrush, kiskadee, sparrows, dove. */
  birdMix: [number, number, number, number];
}

export const AMBIENCE_STYLES = {
  /** A neighbourhood club: birds, a glass at the buffet, the next court going. */
  club: { wind: 0.5, leaves: 0.55, city: 0.5, birds: 2.5, rally: 1.3, clinks: 1.5, birdMix: [3, 1.2, 2, 1] },
  /** A quiet evening: more wind and birds, nobody on the next court. */
  quiet: { wind: 0.65, leaves: 0.75, city: 0.3, birds: 8, rally: 0, clinks: 0.5, birdMix: [3, 1, 2.5, 2] },
  /** A busy evening: two courts going, the buffet busy, fewer birds. */
  busy: { wind: 0.4, leaves: 0.4, city: 0.7, birds: 3, rally: 2.6, clinks: 3, birdMix: [2, 1.5, 2, 0.5] },
} satisfies Record<string, AmbienceStyle>;

export type AmbienceStyleId = keyof typeof AMBIENCE_STYLES;

// ================================================================ bed

/**
 * The bed: wind, leaves and the city far away, `seconds` long, stereo, and
 * seamless when looped. Rendered at a low rate: nothing in it needs more.
 */
export function bed(sr: number, seed: number, seconds: number, style: AmbienceStyle): [Signal, Signal] {
  return finish(bedSteps(sr, seed, seconds, style));
}

/**
 * `bed`, pausing between its stages: each is a pass over the whole buffer,
 * a few milliseconds at most, so the game can render it between frames.
 */
export function* bedSteps(sr: number, seed: number, seconds: number, style: AmbienceStyle): Steps<[Signal, Signal]> {
  const rng = new Rng(seed);
  const fade = 2;
  const n = Math.ceil((seconds + fade) * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  // Wind: pink noise, low, swelling in gusts. Each side gusts a little differently.
  for (const [out, side] of [
    [left, 0],
    [right, 1],
  ] as const) {
    const gust = drift(rng, sr, n, 3.5 + side, 0.25, 1);
    yield;
    const body = pink(rng, n);
    yield;
    filter(sr, body, 'lowpass', 520, 0.6);
    yield;
    filter(sr, body, 'highpass', 70, 0.6);
    yield;
    const leaves = white(rng, n);
    yield;
    filter(sr, leaves, 'bandpass', 3600, 0.5);
    yield;
    filter(sr, leaves, 'lowpass', 7000, 0.6);
    yield;
    // Leaves flutter: their loudness flickers quickly with the gust.
    const flutter = drift(rng, sr, n, 0.035, 0.15, 1);
    yield;
    for (let i = 0; i < n; i++) {
      const g = gust[i]!;
      out[i]! += body[i]! * g * style.wind * 0.5 + leaves[i]! * g * g * flutter[i]! * style.leaves * 0.05;
    }
    yield;
  }

  // The city beyond the trees: a low rumble that never stops, the same on both sides.
  if (style.city > 0) {
    const hum = brown(rng, n);
    yield;
    filter(sr, hum, 'lowpass', 140, 0.6);
    yield;
    filter(sr, hum, 'highpass', 35, 0.6);
    yield;
    for (let i = 0; i < n; i++) {
      left[i]! += hum[i]! * style.city * 0.35;
      right[i]! += hum[i]! * style.city * 0.35;
    }
    yield;
  }
  const loopLeft = seamless(left, sr, fade);
  yield;
  return [loopLeft, seamless(right, sr, fade)];
}

// ================================================================ birds

export type BirdKind = 'thrush' | 'kiskadee' | 'sparrows' | 'dove';

/**
 * A whistled note: a sine with a faint second harmonic, gliding along
 * `contour` (Hz at evenly spaced points), with an optional quick warble.
 */
function whistle(sr: number, rng: Rng, seconds: number, contour: number[], warble = 0, harsh = 0): Signal {
  const n = Math.ceil(seconds * sr);
  const out = new Float32Array(n);
  let phase = 0;
  const warbleRate = vary(rng, 32, 0.2);
  // No bird holds a pitch like an oscillator: a fast, small, uneven wander.
  const wander = drift(rng, sr, n, 0.006, -0.012, 0.012);
  for (let i = 0; i < n; i++) {
    const u = (i / n) * (contour.length - 1);
    const k = Math.min(contour.length - 2, Math.floor(u));
    const fr = u - k;
    const smoothFr = (1 - Math.cos(Math.PI * fr)) / 2;
    let f = contour[k]! + (contour[k + 1]! - contour[k]!) * smoothFr;
    if (warble) f *= 1 + warble * Math.sin((2 * Math.PI * warbleRate * i) / sr);
    f *= 1 + wander[i]!;
    phase += f / sr;
    // A quick start and a softer end, as a bird's note has.
    const x = i / n;
    const env = x < 0.15 ? Math.sin((Math.PI / 2) * (x / 0.15)) : Math.pow(Math.cos((Math.PI / 2) * ((x - 0.15) / 0.85)), 0.7);
    const s = Math.sin(2 * Math.PI * phase);
    // A harsh call is rich in harmonics; a song is nearly pure.
    const h2 = Math.sin(4 * Math.PI * phase) * (0.08 + harsh * 0.5);
    const h3 = Math.sin(6 * Math.PI * phase) * harsh * 0.3;
    out[i] = (s + h2 + h3) * env;
  }
  return out;
}

/** One bird calling, dry and mono, peaking at 0.9: the player places it in the trees. */
export function bird(sr: number, seed: number, kind: BirdKind): Signal {
  return normalize(birdCall(sr, new Rng(seed), kind), 0.9);
}

function birdCall(sr: number, rng: Rng, kind: BirdKind): Signal {
  switch (kind) {
    case 'thrush': {
      // Zorzal colorado: two to four phrases of clear, varied whistles.
      const out = new Float32Array(Math.ceil(sr * 3.2));
      let t = 0;
      const phrases = 2 + Math.floor(rng.next() * 3);
      for (let p = 0; p < phrases; p++) {
        const notes = 2 + Math.floor(rng.next() * 4);
        for (let k = 0; k < notes; k++) {
          const base = rng.range(1800, 3200);
          const shape = Math.floor(rng.next() * 4);
          const contour =
            shape === 0
              ? [base * 0.8, base * 1.15]
              : shape === 1
                ? [base * 1.2, base * 0.85]
                : shape === 2
                  ? [base, base * 1.25, base * 0.95]
                  : [base * 0.95, base, base * 1.02];
          const len = rng.range(0.07, 0.22);
          const note = whistle(sr, rng, len, contour, shape === 3 ? 0.05 : 0);
          mixInto(out, note, Math.round(t * sr), rng.range(0.5, 1));
          t += len + rng.range(0.02, 0.07);
        }
        t += rng.range(0.25, 0.6);
        if (t > 2.8) break;
      }
      return out.subarray(0, Math.min(out.length, Math.ceil((t + 0.1) * sr))).slice();
    }
    case 'kiskadee': {
      // Benteveo: "bi-cho-feo", loud and a little harsh.
      const out = new Float32Array(Math.ceil(sr * 0.9));
      const pitch = rng.range(0.92, 1.08);
      const parts: [number, number[], number][] = [
        [0.11, [1900, 2600], 0],
        [0.1, [2500, 2450], 0.17],
        [0.26, [2300, 2900, 1900], 0.33],
      ];
      for (const [len, contour, at] of parts) {
        const call = whistle(sr, rng, len, contour.map((f) => f * pitch), 0, 0.7);
        mixInto(out, call, Math.round(at * sr), 0.8);
      }
      return out;
    }
    case 'sparrows': {
      // Gorriones gathering in a tree: short falling chirps from several birds.
      const out = new Float32Array(Math.ceil(sr * 2.2));
      const chirps = 6 + Math.floor(rng.next() * 10);
      for (let c = 0; c < chirps; c++) {
        const at = rng.range(0, 1.9);
        const top = rng.range(3800, 5200);
        const chirp = whistle(sr, rng, rng.range(0.045, 0.09), [top, top * rng.range(0.6, 0.75)], 0, 0.4);
        mixInto(out, chirp, Math.round(at * sr), rng.range(0.25, 0.7));
      }
      return out;
    }
    case 'dove': {
      // Torcaza: a soft, low "hu-HUU-hu".
      const out = new Float32Array(Math.ceil(sr * 1.6));
      const base = rng.range(520, 620);
      const notes: [number, number, number][] = [
        [0, 0.22, 0.6],
        [0.32, 0.42, 1],
        [0.86, 0.2, 0.5],
        [1.14, 0.2, 0.45],
      ];
      for (const [at, len, g] of notes) {
        const coo = whistle(sr, rng, len, [base * 0.94, base * 1.04, base * 0.97]);
        mixInto(out, coo, Math.round(at * sr), g);
      }
      filter(sr, out, 'lowpass', 1400, 0.6);
      return out;
    }
  }
}

// ================================================================ the club

/** A glass or a cup at the buffet. */
export function clink(sr: number, seed: number): Signal {
  const rng = new Rng(seed);
  const out = new Float32Array(Math.ceil(sr * 0.8));
  const base = rng.range(2400, 3600);
  const modes: Mode[] = [1, 1.58, 2.31, 3.1].map((r, i) => ({ f: base * r * vary(rng, 1, 0.01), tau: 0.18 / (1 + i * 0.5), g: 0.6 / (1 + i) }));
  ring(out, sr, rng, modes, 0.0003, 0, 0.5);
  // Often a toast: two glasses.
  if (rng.next() < 0.5) {
    const other = modes.map((m) => ({ ...m, f: m.f * rng.range(0.85, 0.95) }));
    ring(out, sr, rng, other, 0.0003, Math.round(sr * rng.range(0.004, 0.012)), 0.4);
  }
  return out;
}

/**
 * A rally on the next court: hits and bounces with the rhythm of real padel,
 * now and then off the glass. Far away, so dull.
 */
export function nextCourt(sr: number, seed: number): Signal {
  return finish(nextCourtSteps(sr, seed));
}

/** `nextCourt`, pausing after each shot. */
export function* nextCourtSteps(sr: number, seed: number): Steps<Signal> {
  const rng = new Rng(seed);
  const shots = 3 + Math.floor(rng.next() * 8);
  const out = new Float32Array(Math.ceil(sr * (shots * 1.4 + 1)));
  let t = 0.05;
  for (let s = 0; s < shots; s++) {
    const near = s % 2 === 0;
    const gain = near ? 1 : 0.7;
    mixInto(out, racketHit(sr, rng, rng.range(0.35, 0.8), RACKET_STYLES.carbon), Math.round(t * sr), gain);
    const flight = rng.range(0.55, 0.75);
    mixInto(out, bounce(sr, rng, rng.range(0.4, 0.7), TURF_STYLES.firm), Math.round((t + flight) * sr), gain * 0.5);
    let next = t + flight + rng.range(0.35, 0.55);
    if (rng.next() < 0.25) {
      mixInto(out, glass(sr, rng, rng.range(0.4, 0.7), GLASS_STYLES.dry), Math.round((next - 0.05) * sr), gain * 0.45);
      next += rng.range(0.3, 0.45);
    }
    t = next;
    yield;
  }
  const end = Math.min(out.length, Math.ceil((t + 0.4) * sr));
  const x = out.subarray(0, end).slice();
  filter(sr, x, 'lowpass', 1700, 0.6);
  yield;
  filter(sr, x, 'highpass', 150, 0.6);
  return x;
}
