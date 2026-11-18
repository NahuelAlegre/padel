/**
 * The sounds of the ball: against the racket, the turf, the glass, the fence
 * and the net. Each one is a struck object: a contact (short when it is hard,
 * long when it is soft) that rings a few modes, plus the noise that comes with
 * it (the crack of a hard hit, the sand of the turf, the rattle of the mesh).
 *
 * Every recipe returns a dry mono buffer. The court's air is added later, by
 * whoever plays it.
 */
import {
  Biquad,
  burst,
  clamp,
  cluster,
  drift,
  filter,
  fadeEdges,
  lerp,
  mixInto,
  ring,
  samples,
  smooth,
  type Mode,
  type Rng,
  type Signal,
  vary,
  white,
} from './dsp';

// ================================================================ racket

/** The character of a racket and ball: what a variant of the hit changes. */
export interface RacketStyle {
  /** Hz: the centre of the "pop", the note of the hit. */
  pop: number;
  /** Octaves the pop's modes are spread over: wider is more wooden, narrower more ringing. */
  spread: number;
  /** Seconds: how long the pop rings. */
  ring: number;
  /** Level of the frame and handle, the low body under the pop. */
  body: number;
  /** Hz of the frame's own note. */
  bodyFreq: number;
  /** Level of the crack: the snap of a hard hit, made of air. */
  crack: number;
  /** Level of the overtones above the pop, which make it sound like carbon. */
  shine: number;
  /** A hollow note of its own (the ball's cavity, a wooden tock), 0 for none. */
  hollow: number;
  hollowFreq: number;
  /** Contact time, seconds, for the softest and the hardest hit. */
  contactSoft: number;
  contactHard: number;
}

export const RACKET_STYLES = {
  /** Carbon faces on an EVA core: a firm pop with some body. The default of a modern racket. */
  carbon: {
    pop: 1080,
    spread: 0.22,
    ring: 0.016,
    body: 0.32,
    bodyFreq: 170,
    crack: 0.5,
    shine: 0.45,
    hollow: 0.12,
    hollowFreq: 640,
    contactSoft: 0.0075,
    contactHard: 0.0032,
  },
  /** A soft foam core: rounder and shorter, a "puc" more than a "pop". */
  foam: {
    pop: 860,
    spread: 0.3,
    ring: 0.011,
    body: 0.45,
    bodyFreq: 150,
    crack: 0.28,
    shine: 0.2,
    hollow: 0.25,
    hollowFreq: 520,
    contactSoft: 0.0095,
    contactHard: 0.0042,
  },
  /** A bright, hollow pop: the ball comes forward, like a tock on a hollow block. */
  hollow: {
    pop: 1350,
    spread: 0.16,
    ring: 0.022,
    body: 0.22,
    bodyFreq: 190,
    crack: 0.6,
    shine: 0.6,
    hollow: 0.55,
    hollowFreq: 760,
    contactSoft: 0.0065,
    contactHard: 0.0028,
  },
} satisfies Record<string, RacketStyle>;

export type RacketStyleId = keyof typeof RACKET_STYLES;

/**
 * The ball on the racket. `power` 0..1: a chiquita is about 0.15, a drive
 * 0.5, a smash 1. Harder is louder, shorter in contact (so brighter) and has
 * more crack; a soft hit is a short, round "puc".
 */
export function racketHit(sr: number, rng: Rng, power: number, style: RacketStyle): Signal {
  const p = clamp(power, 0, 1);
  const out = samples(sr, 0.22);
  const contact = lerp(style.contactSoft, style.contactHard, Math.pow(p, 0.8));
  const at = Math.round(sr * 0.002);
  const level = 0.3 + 0.7 * Math.pow(p, 1.15);

  const modes: Mode[] = [];
  // The pop: a few close modes, slightly detuned so it is a knock and not a note.
  modes.push(...cluster(rng, 6, style.pop, style.spread, style.ring, 1.0));
  // Overtones, shorter: the face of the racket.
  for (const [ratio, g, t] of [
    [2.13, 0.55, 0.45],
    [3.37, 0.4, 0.3],
    [4.9, 0.26, 0.2],
    [7.1, 0.14, 0.14],
  ] as const) {
    modes.push({ f: vary(rng, style.pop * ratio, 0.04), tau: style.ring * t, g: style.shine * g * (rng.next() < 0.5 ? -1 : 1) });
  }
  // The frame and the handle: low, a little longer.
  modes.push({ f: vary(rng, style.bodyFreq, 0.05), tau: 0.016, g: style.body * 0.7 });
  modes.push({ f: vary(rng, style.bodyFreq * 2.45, 0.05), tau: 0.012, g: style.body * 0.5 });
  if (style.hollow > 0) modes.push({ f: vary(rng, style.hollowFreq, 0.03), tau: 0.02, g: style.hollow * 0.7 });
  ring(out, sr, rng, modes, contact, at, level * 0.55);

  // The crack: a puff of air as the ball leaves the face. Only hard hits have much of it.
  const crackLevel = style.crack * Math.pow(p, 1.6);
  if (crackLevel > 0.01) {
    const crack = burst(sr, rng, 0.012, 'bandpass', vary(rng, 3600, 0.15), 0.9, 0.0003, 0.0011);
    mixInto(out, crack, at, crackLevel * 1.4);
  }
  // A whisper of contact noise on every hit, so even a soft one has a front.
  const tick = burst(sr, rng, 0.01, 'highpass', 1800, 0.7, 0.0002, 0.0007 + 0.001 * (1 - p));
  mixInto(out, tick, at, 0.18 * level * (0.3 + 0.7 * p));
  return fadeEdges(out, sr, 0.3, 20);
}

/**
 * The swing of a hard shot: the air through the holes of the racket. A
 * whoosh that rises into the contact, `lead` seconds long; the contact is at
 * the end of the buffer.
 */
export function swing(sr: number, rng: Rng, power: number, lead = 0.2): Signal {
  const n = Math.ceil(sr * (lead + 0.08));
  const x = white(rng, n);
  const out = new Float32Array(n);
  // A bandpass that sweeps up as the racket speeds up.
  const contactAt = lead * sr;
  const band = new Biquad(sr, 'bandpass', 380, 2.2);
  for (let i = 0; i < n; i++) {
    const t = clamp(i / contactAt, 0, 1.4);
    if ((i & 15) === 0) band.set('bandpass', lerp(380, 1500, Math.min(1, t * t)) * (t > 1 ? lerp(1, 0.7, t - 1) : 1), 2.2);
    // Rises like the speed of the racket, falls fast after the contact.
    const env = t <= 1 ? Math.pow(t, 3) : Math.exp(-(t - 1) * 18);
    out[i] = band.tick(x[i]!) * env;
  }
  return fadeEdges(scaleTo(out, 0.25 * (0.4 + 0.6 * power)), sr, 2, 10);
}

function scaleTo(x: Signal, target: number): Signal {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  if (p > 0) for (let i = 0; i < x.length; i++) x[i]! *= target / p;
  return x;
}

// ================================================================ turf

export interface TurfStyle {
  /** Low thump of the ball into the ground. */
  thump: number;
  thumpFreq: number;
  /** The ball's own short "poc". */
  pop: number;
  popFreq: number;
  /** The sand in the turf: a short grainy crunch. */
  sand: number;
  sandTime: number;
  contact: number;
}

export const TURF_STYLES = {
  /** Firm turf with a little sand: a clear, dull "poc". */
  firm: { thump: 0.55, thumpFreq: 120, pop: 0.7, popFreq: 760, sand: 0.1, sandTime: 0.025, contact: 0.006 },
  /** Lots of sand: softer, with grit. */
  sandy: { thump: 0.65, thumpFreq: 105, pop: 0.42, popFreq: 640, sand: 0.22, sandTime: 0.04, contact: 0.0075 },
  /** A dry, ringing bounce: the ball itself comes forward. */
  dry: { thump: 0.4, thumpFreq: 135, pop: 0.95, popFreq: 900, sand: 0.05, sandTime: 0.02, contact: 0.005 },
} satisfies Record<string, TurfStyle>;

export type TurfStyleId = keyof typeof TURF_STYLES;

/** The ball on the turf. `speed` 0..1 (the vertical speed of the bounce, roughly). */
export function bounce(sr: number, rng: Rng, speed: number, style: TurfStyle): Signal {
  const v = clamp(speed, 0, 1);
  const out = samples(sr, 0.16);
  const at = Math.round(sr * 0.001);
  const contact = style.contact * lerp(1.25, 0.85, v);
  const level = 0.18 + 0.82 * Math.pow(v, 1.2);
  const modes: Mode[] = [
    { f: vary(rng, style.thumpFreq, 0.06), tau: 0.009, g: style.thump * 1.1 },
    { f: vary(rng, style.thumpFreq * 2.3, 0.06), tau: 0.006, g: style.thump * 0.5 },
    ...cluster(rng, 5, style.popFreq, 0.25, 0.007, style.pop),
    ...cluster(rng, 3, style.popFreq * 2.4, 0.2, 0.004, style.pop * 0.35),
  ];
  ring(out, sr, rng, modes, contact, at, level * 0.6);
  if (style.sand > 0) mixInto(out, sand(sr, rng, style.sandTime * lerp(0.7, 1.2, v), 0.6), at, style.sand * level);
  return fadeEdges(out, sr, 0.3, 15);
}

/**
 * Grains of sand: a sparse crackle of tiny clicks, denser at the start. It is
 * what turf with sand sounds like under a ball or a shoe.
 */
export function sand(sr: number, rng: Rng, seconds: number, density = 1, bright = 1): Signal {
  const n = Math.ceil(sr * (seconds + 0.01));
  const out = new Float32Array(n);
  const grains = Math.ceil(seconds * 900 * density);
  for (let g = 0; g < grains; g++) {
    // More grains early: the crunch dies out.
    const t = Math.pow(rng.next(), 1.8) * seconds;
    const i = Math.floor(t * sr);
    const amp = (0.3 + rng.next() * 0.7) * Math.exp(-t / (seconds * 0.5));
    const len = 2 + Math.floor(rng.next() * 6);
    for (let k = 0; k < len && i + k < n; k++) out[i + k]! += (rng.next() * 2 - 1) * amp * (1 - k / len);
  }
  filter(sr, out, 'highpass', 1400 * bright, 0.6);
  filter(sr, out, 'lowpass', 9000, 0.6);
  return out;
}

// ================================================================ glass

export interface GlassStyle {
  /** The low boom of the panel. */
  boom: number;
  boomFreq: number;
  boomTime: number;
  /** The knock: the mid of the hit. */
  knock: number;
  knockFreq: number;
  /** A faint ring high up, the glass itself. */
  shimmer: number;
  /** The steel frame around the panel, faintly. */
  frame: number;
  contact: number;
}

export const GLASS_STYLES = {
  /** Dry and deep: a short "bom". */
  dry: { boom: 1, boomFreq: 155, boomTime: 0.04, knock: 0.7, knockFreq: 820, shimmer: 0.05, frame: 0, contact: 0.004 },
  /** More panel: a fuller boom that hangs a little. */
  full: { boom: 1.1, boomFreq: 130, boomTime: 0.07, knock: 0.55, knockFreq: 720, shimmer: 0.08, frame: 0, contact: 0.0045 },
  /** With the frame: the panel shakes in its fixings, a faint metallic edge. */
  framed: { boom: 0.95, boomFreq: 160, boomTime: 0.05, knock: 0.7, knockFreq: 900, shimmer: 0.06, frame: 0.16, contact: 0.004 },
} satisfies Record<string, GlassStyle>;

export type GlassStyleId = keyof typeof GLASS_STYLES;

/** The ball against a glass wall. `speed` 0..1. */
export function glass(sr: number, rng: Rng, speed: number, style: GlassStyle): Signal {
  const v = clamp(speed, 0, 1);
  const out = samples(sr, 0.5);
  const at = Math.round(sr * 0.001);
  const level = 0.25 + 0.75 * Math.pow(v, 1.1);
  const modes: Mode[] = [
    // A panel two by three metres has modes every few hertz: a dense cluster reads as one boom.
    ...cluster(rng, 30, style.boomFreq, 0.6, style.boomTime, style.boom * 1.5, 0.45),
    ...cluster(rng, 10, style.knockFreq, 0.45, 0.012, style.knock * 1.3),
    // High up the panel has hundreds of modes: dense and short, so it is a hiss and not a bell.
    ...cluster(rng, 40, 3000, 0.8, 0.025, style.shimmer * 2, 0.6),
  ];
  ring(out, sr, rng, modes, style.contact * lerp(1.2, 0.9, v), at, level * 0.32);
  // The ball itself: a short "poc" on top.
  ring(out, sr, rng, cluster(rng, 4, 1150, 0.2, 0.006, 0.45), 0.0035, at, level * 0.5);
  if (style.frame > 0) {
    // The frame is steel: a few inharmonic partials, struck a moment later.
    const base = vary(rng, 1250, 0.08);
    const frame: Mode[] = [1, 2.76, 5.4, 8.93].map((r, i) => ({ f: base * r, tau: 0.05 / (1 + i * 0.6), g: 0.5 / (1 + i) }));
    ring(out, sr, rng, frame, 0.0006, at + Math.round(sr * 0.004), style.frame * level);
  }
  mixInto(out, burst(sr, rng, 0.01, 'bandpass', 2400, 0.8, 0.0002, 0.0012), at, 0.12 * level);
  return fadeEdges(out, sr, 0.3, 40);
}

// ================================================================ fence

export interface FenceStyle {
  /** The soft thud of the ball into the mesh. */
  thud: number;
  /** The wires ringing. */
  wires: number;
  wireFreq: number;
  wireTime: number;
  /** The panel rattling against its posts: how long and how loose. */
  rattle: number;
  rattleTime: number;
  /** Rattle hits per second at the start; it slows as it dies. */
  rattleRate: number;
  /** The post: a low metallic clank. */
  post: number;
}

export const FENCE_STYLES = {
  /** A tight mesh: a bright jangle and a short rattle. */
  tight: { thud: 0.5, wires: 0.6, wireFreq: 2300, wireTime: 0.07, rattle: 0.5, rattleTime: 0.2, rattleRate: 38, post: 0.15 },
  /** A loose panel: the "trrrrr" goes on. */
  loose: { thud: 0.45, wires: 0.5, wireFreq: 1900, wireTime: 0.09, rattle: 0.85, rattleTime: 0.4, rattleRate: 30, post: 0.25 },
  /** Hit near a post: more clank, less jangle. */
  post: { thud: 0.6, wires: 0.4, wireFreq: 1600, wireTime: 0.06, rattle: 0.45, rattleTime: 0.25, rattleRate: 26, post: 0.7 },
} satisfies Record<string, FenceStyle>;

export type FenceStyleId = keyof typeof FENCE_STYLES;

/** The ball into the metal fence. `speed` 0..1. */
export function fence(sr: number, rng: Rng, speed: number, style: FenceStyle): Signal {
  const v = clamp(speed, 0, 1);
  const out = samples(sr, 0.2 + style.rattleTime * 1.6 + style.wireTime * 4);
  const at = Math.round(sr * 0.001);
  const level = 0.25 + 0.75 * Math.pow(v, 1.1);
  // The ball into the wire: soft, the mesh gives.
  ring(
    out,
    sr,
    rng,
    [
      { f: vary(rng, 180, 0.08), tau: 0.025, g: 1.2 * style.thud },
      ...cluster(rng, 4, 700, 0.3, 0.008, 0.6 * style.thud),
    ],
    0.007,
    at,
    level * 0.6,
  );
  // The mesh: hundreds of welded wire segments, each with its own inharmonic
  // partials. Together they are a metallic shimmer, not a chord.
  const wireModes: Mode[] = [];
  for (let k = 0; k < 14; k++) {
    const base = style.wireFreq * Math.pow(2, (rng.next() - 0.5) * 1.6);
    for (const [r, g] of [
      [1, 1],
      [2.76, 0.55],
      [5.4, 0.3],
    ] as const) {
      wireModes.push({ f: base * r, tau: vary(rng, style.wireTime / Math.sqrt(r), 0.5), g: ((g * style.wires) / 3.7) * (rng.next() < 0.5 ? -1 : 1) });
    }
  }
  ring(out, sr, rng, wireModes, 0.0012, at + Math.round(sr * 0.002), level * 0.6);

  // The rattle: the panel knocking on its clamps, faster and louder first.
  if (style.rattle > 0) {
    const clank = vary(rng, 1450, 0.1);
    let t = 0.008 + rng.next() * 0.01;
    while (t < style.rattleTime * 1.6) {
      const life = Math.exp(-t / (style.rattleTime * 0.45));
      const amp = style.rattle * life * (0.35 + rng.next() * 0.65);
      // Each knock lands on a slightly different spot of the clamp.
      const where = clank * Math.pow(2, (rng.next() - 0.5) * 0.5);
      const modes: Mode[] = [1, 2.3, 3.9, 6.1].map((r, i) => ({
        f: where * r * (1 + (rng.next() - 0.5) * 0.1),
        tau: 0.01 / (1 + i * 0.4),
        g: 0.6 / (1 + i * 0.7),
      }));
      const when = at + Math.round(t * sr);
      ring(out, sr, rng, modes, 0.0004, when, amp * level * 0.6);
      mixInto(out, burst(sr, rng, 0.006, 'bandpass', vary(rng, 3200, 0.3), 1.2, 0.0001, 0.0012), when, amp * level * 0.35);
      // Slower as it settles, never regular.
      const rate = style.rattleRate * (0.55 + 0.45 * life);
      t += (1 / rate) * (0.6 + rng.next() * 0.8);
    }
  }
  if (style.post > 0) {
    const post: Mode[] = [1, 2.4, 4.1].map((r, i) => ({ f: vary(rng, 340 * r, 0.04), tau: 0.08 / (1 + i), g: 0.7 / (1 + i) }));
    ring(out, sr, rng, post, 0.002, at + Math.round(sr * 0.006), style.post * level * 0.8);
  }
  return fadeEdges(out, sr, 0.3, 40);
}

// ================================================================ net

export interface NetStyle {
  /** The muffled body of the ball into the net. */
  body: number;
  /** The fibres and the rope. */
  rustle: number;
  /** The posts and the cable, faintly. */
  cable: number;
}

export const NET_STYLES = {
  soft: { body: 0.8, rustle: 0.5, cable: 0.12 },
  rope: { body: 0.65, rustle: 0.75, cable: 0.3 },
} satisfies Record<string, NetStyle>;

export type NetStyleId = keyof typeof NET_STYLES;

/** The ball into the net (`cord` false) or clipping the band on top (`cord` true). */
export function net(sr: number, rng: Rng, speed: number, cord: boolean, style: NetStyle): Signal {
  const v = clamp(speed, 0, 1);
  const out = samples(sr, 0.35);
  const at = Math.round(sr * 0.001);
  const level = 0.3 + 0.7 * v;
  if (cord) {
    // The band on top is tight: a sharper tick and a short buzz of the cable.
    ring(out, sr, rng, [...cluster(rng, 4, 1300, 0.3, 0.006, 0.9), { f: 210, tau: 0.03, g: 0.5 }], 0.003, at, level * 0.5);
    const cable: Mode[] = [1, 2.01, 3.03, 4.1].map((r, i) => ({ f: vary(rng, 520 * r, 0.01), tau: 0.12 / (1 + i * 0.5), g: 0.5 / (1 + i) }));
    ring(out, sr, rng, cable, 0.001, at + Math.round(sr * 0.002), style.cable * 1.5 * level);
    mixInto(out, burst(sr, rng, 0.08, 'bandpass', 3000, 0.7, 0.002, 0.02), at, 0.25 * style.rustle * level);
  } else {
    // Into the mesh: it gives, so the contact is long and the sound is round.
    ring(out, sr, rng, [{ f: vary(rng, 140, 0.08), tau: 0.035, g: 1.3 }, ...cluster(rng, 4, 520, 0.35, 0.01, 0.6)], 0.012, at, style.body * level * 0.6);
    const rustle = burst(sr, rng, 0.25, 'bandpass', vary(rng, 2200, 0.15), 0.6, 0.008, 0.05);
    // Fibres brushing: an uneven, flickering texture.
    for (let i = 0; i < rustle.length; i++) rustle[i]! *= 0.5 + 0.5 * Math.abs(Math.sin(i * 0.0021 + rng.next() * 0.3));
    mixInto(out, rustle, at, style.rustle * 0.35 * level);
    const cable: Mode[] = [1, 2.0, 3.1].map((r, i) => ({ f: vary(rng, 480 * r, 0.02), tau: 0.1 / (1 + i), g: 0.4 / (1 + i) }));
    ring(out, sr, rng, cable, 0.002, at + Math.round(sr * 0.02), style.cable * level);
  }
  return fadeEdges(out, sr, 0.3, 30);
}

// ================================================================ feet

export type StepKind = 'step' | 'split' | 'slide' | 'squeak';

export interface FeetStyle {
  /** Sand under the shoe. */
  sand: number;
  /** The rubber sole on the turf. */
  squeak: number;
  /** The weight landing. */
  thump: number;
}

export const FEET_STYLES = {
  /** Turf with sand, as on a padel court: crunch and scrape, almost no squeak. */
  sand: { sand: 1, squeak: 0, thump: 0.6 },
  /** Rubber on a cleaner, faster court: short chirps on the stops. */
  rubber: { sand: 0.35, squeak: 0.8, thump: 0.5 },
  /** Both: mostly sand, a chirp now and then on a hard stop. */
  mixed: { sand: 0.8, squeak: 0.35, thump: 0.55 },
} satisfies Record<string, FeetStyle>;

export type FeetStyleId = keyof typeof FEET_STYLES;

/**
 * One movement of the feet. `step`: a quick heel and toe. `split`: the little
 * hop before the opponent hits, both feet landing at once. `slide`: a braking
 * scrape. `squeak`: the sole gripping on a sharp change of direction.
 */
export function feet(sr: number, rng: Rng, kind: StepKind, style: FeetStyle): Signal {
  const out = samples(sr, kind === 'slide' ? 0.42 : 0.24);
  const thump = (at: number, g: number) =>
    ring(out, sr, rng, [{ f: vary(rng, 75, 0.1), tau: 0.02, g: 1.2 }, { f: vary(rng, 190, 0.1), tau: 0.012, g: 0.5 }], 0.012, at, g * style.thump * 0.5);
  switch (kind) {
    case 'step': {
      const toe = Math.round(sr * vary(rng, 0.045, 0.3));
      thump(0, 0.8);
      mixInto(out, sand(sr, rng, 0.04, 0.8), 0, style.sand * 0.35);
      thump(toe, 0.4);
      mixInto(out, sand(sr, rng, 0.05, 0.7, 1.1), toe, style.sand * 0.3);
      break;
    }
    case 'split': {
      // Two feet, a few milliseconds apart.
      const second = Math.round(sr * vary(rng, 0.018, 0.4));
      thump(0, 1);
      thump(second, 0.9);
      mixInto(out, sand(sr, rng, 0.05, 1.2), 0, style.sand * 0.4);
      mixInto(out, sand(sr, rng, 0.05, 1.0), second, style.sand * 0.35);
      break;
    }
    case 'slide': {
      thump(0, 0.6);
      const scrape = sand(sr, rng, 0.32, 2.4, 0.8);
      // A scrape swells and fades, unlike a crunch.
      for (let i = 0; i < scrape.length; i++) {
        const t = i / scrape.length;
        scrape[i]! *= smooth(t * 6) * (1 - smooth((t - 0.5) * 2));
      }
      mixInto(out, scrape, 0, style.sand * 0.55);
      if (style.squeak > 0) mixInto(out, squeak(sr, rng, 0.14), Math.round(sr * 0.05), style.squeak * 0.4);
      break;
    }
    case 'squeak': {
      thump(0, 0.5);
      mixInto(out, sand(sr, rng, 0.06, 1), 0, style.sand * 0.3);
      if (style.squeak > 0) mixInto(out, squeak(sr, rng, vary(rng, 0.11, 0.3)), Math.round(sr * 0.01), style.squeak * 0.55);
      else mixInto(out, sand(sr, rng, 0.12, 2, 0.9), Math.round(sr * 0.01), style.sand * 0.4);
      break;
    }
  }
  return fadeEdges(out, sr, 0.3, 20);
}

/**
 * Rubber gripping and slipping: a train of tiny stick-slip impulses whose
 * rate wobbles, through a resonance. That is what makes a squeak a chirp and
 * not a whistle.
 */
export function squeak(sr: number, rng: Rng, seconds: number): Signal {
  const n = Math.ceil(sr * seconds);
  const out = new Float32Array(n);
  const f0 = vary(rng, 900, 0.25);
  const bend = rng.range(-0.2, 0.3);
  // The grip comes and goes unevenly: a slow random wander, never a vibrato.
  const wander = drift(rng, sr, n, 0.012, -0.05, 0.05);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const wobble = 1 + wander[i]! + (rng.next() - 0.5) * 0.12;
    const f = f0 * (1 + bend * t) * wobble;
    phase += f / sr;
    if (phase >= 1) {
      phase -= 1;
      out[i] = 1;
    }
  }
  filter(sr, out, 'bandpass', f0 * 2.2, 3);
  filter(sr, out, 'peaking', f0 * 4.3, 4, 6);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i]! *= Math.sin(Math.PI * Math.pow(t, 0.6)) * 3;
  }
  return out;
}
