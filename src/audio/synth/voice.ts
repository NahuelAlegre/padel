/**
 * A small speaking voice, for the shouts and murmurs of the people on court.
 *
 * It is a formant synthesizer in the tradition of Dennis Klatt's: a glottal
 * source (the buzz of the vocal folds, with the little irregularities that
 * make it human) through a cascade of resonances (the shape of the mouth),
 * plus noise for breath, "s" and "sh". Rioplatense Spanish is written almost
 * as it sounds, so a line of text becomes phonemes with a few rules ("ll" and
 * "y" are "sh", a final "s" is breathed).
 *
 * It never has to be intelligible from across the court: what matters is
 * that it sounds like a person with a mood, a pitch and an age.
 */
import { Rng } from '../../core/rng';
import { AntiResonator, Biquad, clamp, lerp, OnePole, Resonator, type Signal } from './dsp';

// ================================================================ who is speaking

export interface VoiceProfile {
  /** Hz: the speaking pitch at rest. */
  f0: number;
  /** Formant scale: 1 for an adult man, about 1.15 for a woman. */
  size: number;
  /** Open quotient, 0.4 (pressed, bright) to 0.75 (soft, breathy). */
  oq: number;
  /** Hz: where the voice's brightness starts to fall. Low is dark and soft. */
  tilt: number;
  /** Breath in the voice, 0..1. */
  breath: number;
  /** Period-to-period irregularity of pitch and loudness: a little is human, a lot is old or rough. */
  jitter: number;
  shimmer: number;
  /** A slow tremble of the pitch, as in an older voice. */
  tremor: { rate: number; depth: number };
  /** Vocal fry at the end of a falling phrase, 0..1. */
  creak: number;
  /** Speaking rate: 1 is normal. */
  rate: number;
  /** How far the pitch moves: 1 is normal, more is more expressive. */
  range: number;
}

/** How a phrase is said. */
export type Tune =
  /** "¡Eso!": up to the stressed syllable, down at the end. */
  | 'exclaim'
  /** A shout that stays high. */
  | 'shout'
  /** Friendly and level. */
  | 'calm'
  /** Disappointment: a long fall. */
  | 'sad'
  /** Surprise or a question: up at the end. */
  | 'rise'
  /** Sing-song: up, down and up again. */
  | 'sing'
  /** Each syllable a small fall, each one lower. */
  | 'laugh'
  /** Effort: short, pressed, cut off. */
  | 'grunt'
  /** Fast chatter, every syllable at its own pitch: the murmur of a cartoon character. */
  | 'chatter';

export interface SayOptions {
  tune: Tune;
  /** 0 calm .. 1 shouting: higher, brighter, louder. */
  effort?: number;
  /** Stretch of the last vowel ("¡Nooo!"): 1 is none. */
  hold?: number;
  /** Speed on top of the profile's rate. */
  rate?: number;
  /** Semitones on top of the profile's pitch. */
  pitch?: number;
  /** How it starts: a clean attack, a breath before, or a soft swell. */
  onset?: 'hard' | 'breathy' | 'soft';
  /** How it ends: breath, a creak, or cut short. */
  release?: 'breathy' | 'creak' | 'cut';
  /** Murmur: no consonants that stop the air, every syllable a quick blip. */
  murmur?: boolean;
}

// ================================================================ phonemes

type Kind = 'vowel' | 'glide' | 'nasal' | 'liquid' | 'tap' | 'trill' | 'fric' | 'stop' | 'aspirate' | 'pause';

interface PhoneDef {
  kind: Kind;
  /** F1..F3 for an adult man. */
  f: [number, number, number];
  voiced: boolean;
  /** Milliseconds at rate 1. */
  dur: number;
  /** Voicing amplitude, relative to a vowel. */
  av: number;
  /** Frication: two resonances and a level. */
  fric?: [number, number, number, number, number];
  /** Burst of a stop: centre, bandwidth, level. */
  burst?: [number, number, number];
  /** Aspiration after a release (ms). */
  vot?: number;
  nasal?: boolean;
}

const V = (f1: number, f2: number, f3: number, dur: number): PhoneDef => ({ kind: 'vowel', f: [f1, f2, f3], voiced: true, dur, av: 1 });

const PHONES: Record<string, PhoneDef> = {
  a: V(720, 1260, 2500, 85),
  e: V(470, 1850, 2550, 78),
  i: V(300, 2200, 2950, 70),
  o: V(490, 950, 2450, 80),
  u: V(330, 780, 2350, 75),
  j: { kind: 'glide', f: [290, 2150, 2900], voiced: true, dur: 38, av: 0.8 },
  w: { kind: 'glide', f: [330, 760, 2300], voiced: true, dur: 38, av: 0.8 },
  m: { kind: 'nasal', f: [250, 1050, 2250], voiced: true, dur: 62, av: 0.2, nasal: true },
  n: { kind: 'nasal', f: [250, 1650, 2550], voiced: true, dur: 55, av: 0.2, nasal: true },
  ñ: { kind: 'nasal', f: [260, 2100, 2800], voiced: true, dur: 66, av: 0.2, nasal: true },
  l: { kind: 'liquid', f: [360, 1400, 2700], voiced: true, dur: 55, av: 0.62 },
  ɾ: { kind: 'tap', f: [400, 1500, 2350], voiced: true, dur: 24, av: 0.45 },
  r: { kind: 'trill', f: [400, 1450, 2300], voiced: true, dur: 78, av: 0.5 },
  s: { kind: 'fric', f: [400, 1750, 2600], voiced: false, dur: 92, av: 0, fric: [5200, 900, 7600, 1600, 0.55] },
  ʃ: { kind: 'fric', f: [350, 2050, 2700], voiced: false, dur: 98, av: 0, fric: [2700, 700, 4300, 1300, 1] },
  f: { kind: 'fric', f: [400, 950, 2400], voiced: false, dur: 86, av: 0, fric: [2000, 3500, 7000, 3500, 0.3] },
  x: { kind: 'fric', f: [500, 1350, 2500], voiced: false, dur: 78, av: 0, fric: [1500, 600, 2900, 900, 0.35] },
  h: { kind: 'aspirate', f: [600, 1300, 2500], voiced: false, dur: 55, av: 0 },
  p: { kind: 'stop', f: [400, 850, 2300], voiced: false, dur: 62, av: 0, burst: [1200, 2400, 0.32], vot: 12 },
  t: { kind: 'stop', f: [400, 1750, 2600], voiced: false, dur: 58, av: 0, burst: [4200, 1800, 0.42], vot: 14 },
  k: { kind: 'stop', f: [400, 1650, 2400], voiced: false, dur: 64, av: 0, burst: [2000, 1000, 0.45], vot: 24 },
  b: { kind: 'stop', f: [300, 850, 2300], voiced: true, dur: 48, av: 0.12, burst: [1100, 2000, 0.12], vot: 0 },
  d: { kind: 'stop', f: [300, 1650, 2600], voiced: true, dur: 44, av: 0.12, burst: [3600, 1800, 0.14], vot: 0 },
  g: { kind: 'stop', f: [300, 1500, 2350], voiced: true, dur: 50, av: 0.12, burst: [1900, 1000, 0.15], vot: 0 },
  // Between vowels, b d g in Spanish barely close: approximants.
  β: { kind: 'liquid', f: [320, 900, 2300], voiced: true, dur: 42, av: 0.45 },
  ð: { kind: 'liquid', f: [340, 1600, 2600], voiced: true, dur: 38, av: 0.5 },
  ɣ: { kind: 'liquid', f: [330, 1350, 2400], voiced: true, dur: 44, av: 0.45 },
  '_': { kind: 'pause', f: [500, 1500, 2500], voiced: false, dur: 70, av: 0 },
};

const VOWELS = 'aeiou';

export interface Phone {
  ph: string;
  stress: boolean;
  /** Index of the word in the phrase. */
  word: number;
  /** Held: three times as long. */
  long?: boolean;
}

/**
 * Rioplatense Spanish, from spelling to phonemes. Enough for short lines:
 * seseo, "ll" and "y" as "sh", "j" and "ge/gi" as a breathy "x", silent "h",
 * "qu" and "gu", "rr" and initial "r" trilled, b d g softened between vowels,
 * and the stress from the accent mark or the usual rule.
 */
export function phonemes(text: string): Phone[] {
  // Written as phonemes: "/m:* _ h m:" (":" holds a sound, "*" stresses it).
  if (text.startsWith('/')) {
    return text
      .slice(1)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const ph = token.replace(/[:*]/g, '');
        return { ph: PHONES[ph] ? ph : '_', stress: token.includes('*'), word: 0, long: token.includes(':') };
      });
  }
  const words = text
    .toLowerCase()
    .replace(/[¡!¿?.,;:…"«»()\-–—]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: Phone[] = [];
  words.forEach((raw, w) => {
    const phones: { ph: string; accent: boolean }[] = [];
    const word = raw;
    for (let i = 0; i < word.length; i++) {
      const c = word[i]!;
      const next = word[i + 1] ?? '';
      const prev = word[i - 1] ?? '';
      const accented = 'áéíóú'.indexOf(c);
      if (accented >= 0) {
        phones.push({ ph: VOWELS[accented]!, accent: true });
        continue;
      }
      const frontNext = next === 'e' || next === 'i' || next === 'é' || next === 'í';
      switch (c) {
        case 'a':
        case 'e':
        case 'o':
          phones.push({ ph: c, accent: false });
          break;
        case 'i':
        case 'u': {
          // Next to another vowel, i and u glide.
          const vowelNear = /[aeoáéó]/.test(next) || (/[aeoáéó]/.test(prev) && !/[aeiouáéíóú]/.test(next));
          if (c === 'u' && (prev === 'q' || (prev === 'g' && frontNext))) break;
          phones.push({ ph: vowelNear ? (c === 'i' ? 'j' : 'w') : c, accent: false });
          break;
        }
        case 'ü':
          phones.push({ ph: 'w', accent: false });
          break;
        case 'y':
          phones.push({ ph: /[aeiouáéíóú]/.test(next) ? 'ʃ' : 'i', accent: false });
          break;
        case 'c':
          if (next === 'h') {
            phones.push({ ph: 't', accent: false }, { ph: 'ʃ', accent: false });
            i++;
          } else phones.push({ ph: frontNext ? 's' : 'k', accent: false });
          break;
        case 'q':
          phones.push({ ph: 'k', accent: false });
          break;
        case 'g':
          phones.push({ ph: frontNext ? 'x' : 'g', accent: false });
          break;
        case 'j':
          phones.push({ ph: 'x', accent: false });
          break;
        case 'h':
          break;
        case 'l':
          if (next === 'l') {
            phones.push({ ph: 'ʃ', accent: false });
            i++;
          } else phones.push({ ph: 'l', accent: false });
          break;
        case 'r':
          if (next === 'r') {
            phones.push({ ph: 'r', accent: false });
            i++;
          } else phones.push({ ph: i === 0 || 'nls'.includes(prev) ? 'r' : 'ɾ', accent: false });
          break;
        case 'v':
          phones.push({ ph: 'b', accent: false });
          break;
        case 'z':
          phones.push({ ph: 's', accent: false });
          break;
        case 'x':
          phones.push({ ph: 'k', accent: false }, { ph: 's', accent: false });
          break;
        case 'w':
          phones.push({ ph: 'w', accent: false });
          break;
        case 'ñ':
          phones.push({ ph: 'ñ', accent: false });
          break;
        default:
          if (PHONES[c]) phones.push({ ph: c, accent: false });
      }
    }
    // Stress: the accent mark, else the usual rule.
    const nuclei = phones.map((p, i) => (VOWELS.includes(p.ph) ? i : -1)).filter((i) => i >= 0);
    let stressed = phones.findIndex((p) => p.accent);
    if (stressed < 0 && nuclei.length > 0) {
      const last = word[word.length - 1] ?? '';
      const penult = /[aeiouns]/.test(last);
      stressed = nuclei[penult && nuclei.length > 1 ? nuclei.length - 2 : nuclei.length - 1]!;
    }
    phones.forEach((p, i) => {
      let ph = p.ph;
      const before = i > 0 ? phones[i - 1]!.ph : w > 0 ? 'a' : '_';
      const afterVowel = VOWELS.includes(before) || 'jwlɾr'.includes(before);
      // b d g soften after a vowel, also across words.
      if (afterVowel && ph === 'b') ph = 'β';
      if (afterVowel && ph === 'd') ph = 'ð';
      if (afterVowel && ph === 'g') ph = 'ɣ';
      // A final s is breathed, as in "vamo(h)".
      if (ph === 's' && i === phones.length - 1) ph = 'h';
      out.push({ ph, stress: i === stressed, word: w });
    });
  });
  return out;
}

// ================================================================ the plan of a phrase

interface Segment {
  def: PhoneDef;
  ph: string;
  start: number;
  end: number;
  stress: boolean;
  /** Index of the syllable this segment belongs to (its vowel's order). */
  syllable: number;
}

/** Frame rate of the parameter tracks. */
const FRAME = 0.0025;

interface Tracks {
  n: number;
  f1: Float32Array;
  f2: Float32Array;
  f3: Float32Array;
  av: Float32Array;
  ah: Float32Array;
  af: Float32Array;
  ff1: Float32Array;
  fb1: Float32Array;
  ff2: Float32Array;
  fb2: Float32Array;
  nasal: Float32Array;
  pitch: Float32Array;
}

function tracks(n: number): Tracks {
  const t = () => new Float32Array(n);
  return { n, f1: t(), f2: t(), f3: t(), av: t(), ah: t(), af: t(), ff1: t(), fb1: t(), ff2: t(), fb2: t(), nasal: t(), pitch: t() };
}

/** Forward-backward one-pole smoothing: the mouth moves smoothly from one shape to the next. */
function smoothTrack(x: Float32Array, seconds: number): void {
  const a = Math.exp(-FRAME / Math.max(1e-4, seconds));
  for (let i = 1; i < x.length; i++) x[i] = x[i]! + a * (x[i - 1]! - x[i]!);
  for (let i = x.length - 2; i >= 0; i--) x[i] = x[i]! + a * (x[i + 1]! - x[i]!);
}

function layout(phones: Phone[], opts: SayOptions, profile: VoiceProfile): Segment[] {
  const rate = profile.rate * (opts.rate ?? 1) * (opts.murmur ? 1.9 : 1);
  const segs: Segment[] = [];
  let t = 0;
  let syllable = -1;
  const lastVowel = phones.map((p) => VOWELS.includes(p.ph)).lastIndexOf(true);
  phones.forEach((p, i) => {
    const def = PHONES[p.ph] ?? PHONES['_']!;
    let dur = def.dur / 1000;
    if (def.kind === 'vowel') {
      syllable++;
      if (p.stress) dur *= 1.3;
      if (i === lastVowel) dur *= 1.35 * (opts.hold ?? 1);
      if (opts.tune === 'grunt') dur *= 0.8;
    }
    if (p.long) dur *= 3;
    if (opts.murmur && def.kind !== 'vowel') dur *= 0.7;
    if (opts.effort && def.kind === 'vowel') dur *= 1 + 0.15 * opts.effort;
    dur /= rate;
    const start = t;
    t += dur;
    segs.push({ def, ph: p.ph, start, end: t, stress: p.stress, syllable: Math.max(0, syllable) });
  });
  return segs;
}

/** The pitch curve, in semitones, at time `t` of a phrase `total` seconds long. */
function tuneAt(tune: Tune, t: number, total: number, accent: number, syl: { index: number; count: number; t: number }, finalUp: boolean): number {
  const u = clamp(t / Math.max(1e-3, total), 0, 1);
  const a = clamp(accent / Math.max(1e-3, total), 0.05, 0.95);
  const curve = (points: [number, number][]) => {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1]!;
      const [x1, y1] = points[i]!;
      if (u <= x1) {
        const k = (u - x0) / Math.max(1e-4, x1 - x0);
        return lerp(y0, y1, (1 - Math.cos(Math.PI * clamp(k, 0, 1))) / 2);
      }
    }
    return points[points.length - 1]![1];
  };
  switch (tune) {
    case 'exclaim':
      return curve([[0, 1.5], [a, 6], [Math.min(0.98, a + 0.18), 4.5], [1, -3]]);
    case 'shout':
      return curve([[0, 2.5], [a, 6.5], [Math.min(0.98, a + 0.25), 5.5], [0.92, 3], [1, -0.5]]);
    case 'calm':
      return curve([[0, 1], [a, 3], [1, -2]]);
    case 'sad':
      return curve([[0, 4], [0.25, 5.5], [1, -5]]);
    case 'rise':
      return curve([[0, 1], [0.4, -0.5], [1, 7]]);
    case 'sing':
      return curve([[0, 2], [a, 7.5], [Math.min(0.9, a + 0.2), 3], [1, 5.5]]);
    case 'grunt':
      return curve([[0, 4], [0.35, 5], [1, 0]]);
    case 'laugh': {
      // Each "ja" falls a little and starts a bit lower than the last.
      const within = clamp(syl.t, 0, 1);
      return 4 - syl.index * 0.9 - within * 2.5;
    }
    case 'chatter': {
      // Each syllable jumps to its own note, around a slow fall.
      const seed = Math.sin((syl.index + 1) * 12.9898) * 43758.5453;
      const note = (seed - Math.floor(seed)) * 6 - 2;
      return note + 2 - u * 3 + (syl.index === syl.count - 1 ? (finalUp ? 3 : -2) * syl.t : 0);
    }
  }
}

// ================================================================ the voice

/**
 * Says `text` in `profile`'s voice. Returns a mono buffer at `sr`, peaking
 * near 0.9 for a shout and lower for calm speech.
 */
export function say(sr: number, seed: number, text: string, profile: VoiceProfile, opts: SayOptions): Signal {
  const rng = new Rng(seed);
  const phones = phonemes(text);
  if (phones.length === 0) return new Float32Array(1);
  const effort = clamp(opts.effort ?? 0.3, 0, 1);
  const segs = layout(phones, opts, profile);
  const onset = opts.onset ?? 'soft';
  const release = opts.release ?? 'breathy';
  const lead = onset === 'breathy' ? 0.05 : 0.01;
  const tail = release === 'breathy' ? 0.09 : release === 'creak' ? 0.12 : 0.03;
  const speechEnd = segs[segs.length - 1]!.end;
  const total = lead + speechEnd + tail;
  const frames = Math.ceil(total / FRAME) + 2;
  const tr = tracks(frames);
  const size = profile.size;
  const f1Boost = 1 + 0.12 * effort;
  const syllables = segs.reduce((m, s) => Math.max(m, s.syllable), 0) + 1;
  const accentSeg =
    [...segs].reverse().find((s) => s.stress && s.def.voiced) ?? segs.find((s) => s.def.kind === 'vowel') ?? segs[0];
  const accent = lead + (accentSeg ? accentSeg.start : 0);
  const finalUp = rng.next() < 0.5;

  // Targets, frame by frame.
  for (let k = 0; k < frames; k++) {
    const t = k * FRAME - lead;
    let seg = segs[0]!;
    if (t >= 0) seg = segs.find((s) => t < s.end) ?? segs[segs.length - 1]!;
    // Before speech, the mouth already has the first shape; after it, the last.
    const def = seg.def;
    const f = def.f;
    tr.f1[k] = f[0] * size * (def.kind === 'vowel' ? f1Boost : 1);
    tr.f2[k] = f[1] * size;
    tr.f3[k] = f[2] * size;
    tr.nasal[k] = def.nasal ? 1 : 0;
    const inSpeech = t >= 0 && t < speechEnd;
    const local = (t - seg.start) / Math.max(1e-4, seg.end - seg.start);
    let av = inSpeech ? def.av : 0;
    let ah = 0;
    let af = 0;
    if (inSpeech) {
      if (def.kind === 'vowel' && seg.stress) av *= 1.25;
      if (def.kind === 'trill') av *= 0.5 + 0.5 * Math.abs(Math.sin(local * Math.PI * 3));
      if (def.kind === 'tap') av *= 0.4 + 0.6 * Math.abs(Math.cos(local * Math.PI));
      if (def.kind === 'aspirate') ah = 0.9;
      if (def.kind === 'fric' && def.fric) {
        af = def.fric[4] * (opts.murmur ? 0.5 : 1);
        if (seg.ph === 'x') ah = 0.6;
        tr.ff1[k] = def.fric[0];
        tr.fb1[k] = def.fric[1];
        tr.ff2[k] = def.fric[2];
        tr.fb2[k] = def.fric[3];
      }
      if (def.kind === 'stop' && def.burst) {
        const dur = seg.end - seg.start;
        const vot = (def.vot ?? 0) / 1000;
        const releaseAt = dur - vot - 0.008;
        const sinceRelease = t - seg.start - releaseAt;
        if (opts.murmur) {
          // Murmur: a stop is only a dip.
          av = 0.25;
        } else if (sinceRelease >= 0 && sinceRelease < 0.008) {
          af = def.burst[2];
          tr.ff1[k] = def.burst[0];
          tr.fb1[k] = def.burst[1];
          tr.ff2[k] = def.burst[0] * 1.6;
          tr.fb2[k] = def.burst[1] * 1.5;
        } else if (sinceRelease >= 0.008) {
          ah = 0.55;
        }
      }
    }
    // A breath before the first sound, and one after the last.
    if (t < 0 && onset === 'breathy' && t > -lead) ah = 0.5 * (1 + t / lead);
    if (t >= speechEnd && release === 'breathy') ah = 0.45 * Math.max(0, 1 - (t - speechEnd) / tail);
    tr.av[k] = av;
    tr.ah[k] = ah;
    tr.af[k] = af;
    if (tr.ff1[k] === 0) {
      tr.ff1[k] = 3000;
      tr.fb1[k] = 1000;
      tr.ff2[k] = 5000;
      tr.fb2[k] = 1500;
    }
    // Pitch.
    const sylSeg = seg;
    const sylStart = segs.find((s) => s.syllable === sylSeg.syllable && s.def.kind === 'vowel');
    const sylT = sylStart ? (t - sylStart.start) / Math.max(1e-3, sylStart.end - sylStart.start) : 0;
    const semis = tuneAt(opts.tune, Math.max(0, t), speechEnd, accent - lead, { index: seg.syllable, count: syllables, t: sylT }, finalUp);
    tr.pitch[k] = semis * profile.range + (opts.pitch ?? 0) + effort * 4;
  }
  // The mouth moves smoothly; the voice switches on and off faster.
  smoothTrack(tr.f1, 0.018);
  smoothTrack(tr.f2, 0.024);
  smoothTrack(tr.f3, 0.024);
  smoothTrack(tr.nasal, 0.01);
  smoothTrack(tr.av, onset === 'hard' ? 0.004 : 0.007);
  smoothTrack(tr.ah, 0.01);
  smoothTrack(tr.af, 0.004);
  smoothTrack(tr.pitch, opts.tune === 'chatter' ? 0.012 : 0.03);
  for (const x of [tr.ff1, tr.fb1, tr.ff2, tr.fb2]) smoothTrack(x, 0.006);

  return render(sr, rng, tr, total, profile, effort, release, speechEnd + lead);
}

function render(
  sr: number,
  rng: Rng,
  tr: Tracks,
  total: number,
  p: VoiceProfile,
  effort: number,
  release: 'breathy' | 'creak' | 'cut',
  speechEnd: number,
): Signal {
  const n = Math.ceil(total * sr);
  const out = new Float32Array(n);
  const r1 = new Resonator(sr);
  const r2 = new Resonator(sr);
  const r3 = new Resonator(sr);
  const r4 = new Resonator(sr);
  const r5 = new Resonator(sr);
  const np = new Resonator(sr);
  const nz = new AntiResonator(sr);
  const fr1 = new Resonator(sr);
  const fr2 = new Resonator(sr);
  const tiltLp = new OnePole(sr, lerp(p.tilt, p.tilt * 2.2, effort));
  const breathHp = new Biquad(sr, 'highpass', 400, 0.7);
  const fricHp = new Biquad(sr, 'highpass', 1000, 0.7);
  const dc = new Biquad(sr, 'highpass', 70, 0.7);
  const air = new Biquad(sr, 'lowpass', Math.min(sr * 0.45, 9500), 0.7);
  const oq = clamp(lerp(p.oq, p.oq - 0.18, effort), 0.3, 0.85);
  const size = p.size;
  const f4 = 3400 * size;
  const f5 = 4300 * size;
  const bwScale = 1 + p.breath * 0.6;
  r4.set(f4, 250);
  r5.set(f5, 320);

  let phase = 0;
  let periodF0 = p.f0;
  let periodAmp = 1;
  let prevFlow = 0;
  let wander = 0;
  let wanderTarget = 0;
  const step = sr * FRAME;
  let k = 0;
  let fr = 0;
  const get = (x: Float32Array) => x[k]! + (x[k + 1]! - x[k]!) * fr;
  for (let i = 0; i < n; i++) {
    const fpos = i / step;
    k = Math.min(tr.n - 2, Math.floor(fpos));
    fr = Math.min(1, fpos - k);
    const time = i / sr;

    if ((i & 31) === 0) {
      r1.set(get(tr.f1), 75 * bwScale + 20 * effort);
      r2.set(get(tr.f2), 95 * bwScale);
      r3.set(get(tr.f3), 140 * bwScale);
      const nasal = get(tr.nasal);
      np.set(270, 100);
      nz.set(lerp(270, 950, nasal), lerp(100, 120, nasal));
      fr1.set(get(tr.ff1), get(tr.fb1));
      fr2.set(get(tr.ff2), get(tr.fb2));
      // A slow wander of the pitch, as nobody holds a note perfectly still.
      if ((i & 2047) === 0) wanderTarget = (rng.next() * 2 - 1) * 0.35;
    }
    wander += (wanderTarget - wander) * 0.0004;

    // Pitch, with the tremor of the profile; a creak at the end drops it and roughens it.
    let semis = get(tr.pitch) + wander + p.tremor.depth * Math.sin(2 * Math.PI * p.tremor.rate * time);
    let creaking = 0;
    if (release === 'creak' && p.creak > 0 && time > speechEnd - 0.1) {
      creaking = clamp((time - (speechEnd - 0.1)) / 0.1, 0, 1) * p.creak;
      semis -= creaking * 9;
    }
    const f0 = p.f0 * Math.pow(2, semis / 12);

    // The glottis: one cycle at a time, each a little different.
    phase += periodF0 / sr;
    if (phase >= 1) {
      phase -= 1;
      const j = p.jitter * (1 + creaking * 6);
      periodF0 = f0 * (1 + rng.gauss() * j);
      periodAmp = 1 + rng.gauss() * (p.shimmer + creaking * 0.4);
    }
    // KLGLOTT88 flow; its first difference is the antialiased flow derivative.
    const tt = phase / oq;
    const flow = tt < 1 ? tt * tt - tt * tt * tt : 0;
    // Scaled so a high note is only a little louder than a low one.
    const dFlow = (flow - prevFlow) * (sr / Math.sqrt(220 * periodF0));
    prevFlow = flow;
    const av = get(tr.av);
    let voice = tiltLp.tick(dFlow) * av * periodAmp * 9;

    // Breath: noise that pulses with the glottis, louder in a breathy voice.
    const noise = breathHp.tick(rng.next() * 2 - 1);
    const open = tt < 1 ? 1 : 0.35;
    const ah = get(tr.ah);
    const breath = noise * (ah * 3 + av * p.breath * 0.9 * open);
    voice += breath;

    // The mouth.
    let y = np.tick(voice);
    y = nz.tick(y);
    y = r1.tick(y);
    y = r2.tick(y);
    y = r3.tick(y);
    y = r4.tick(y);
    y = r5.tick(y);

    // Frication, in parallel.
    const af = get(tr.af);
    if (af > 1e-4) {
      const fn = fricHp.tick(rng.next() * 2 - 1);
      y += (fr1.tick(fn) * 0.6 + fr2.tick(fn) * 0.5) * af * 7;
    } else {
      fr1.tick(0);
      fr2.tick(0);
    }
    out[i] = air.tick(dc.tick(y));
  }
  // Level: a shout near full scale, calm speech lower.
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]!));
  const target = 0.55 + 0.35 * effort;
  if (pk > 0) for (let i = 0; i < n; i++) out[i]! *= target / pk;
  // No click at either end.
  const fade = Math.min(n, Math.round(sr * 0.004));
  for (let i = 0; i < fade; i++) {
    out[i]! *= i / fade;
    out[n - 1 - i]! *= i / fade;
  }
  return out;
}
