/**
 * The game's sounds: the versions chosen by ear on the listening board
 * (design/sonido/tablero.html), the strengths each one is rendered at, how
 * many takes of each (so the same hit twice is never the same sound), and
 * the balance between them.
 *
 * Everything here is pure: it renders into plain arrays, in the browser after
 * the first frame or in Node for the tests and `npm run sounds`.
 */
import type { SoundCue } from '../platform/types';
import { Rng } from '../core/rng';
import { normalize, room, trim, type Signal } from './synth/dsp';
import {
  bounce,
  FEET_STYLES,
  feet,
  fence,
  FENCE_STYLES,
  glass,
  GLASS_STYLES,
  net,
  NET_STYLES,
  RACKET_STYLES,
  racketHit,
  swing,
  TURF_STYLES,
} from './synth/impacts';
import type { AmbienceStyleId } from './synth/ambience';

/** What was chosen on the board, on 2026-11-18: the first version of everything. */
export const CHOSEN = {
  racket: RACKET_STYLES.carbon,
  turf: TURF_STYLES.firm,
  glass: GLASS_STYLES.dry,
  fence: FENCE_STYLES.tight,
  net: NET_STYLES.soft,
  feet: FEET_STYLES.sand,
  ambience: 'club' as AmbienceStyleId,
};

/** The match's sounds are rendered at this rate; the browser converts if it runs at another. */
export const SFX_RATE = 44100;

/** Seconds of the swing before the contact. */
export const SWING_LEAD = 0.2;

interface CueSpec {
  /** Strengths rendered: an event takes the nearest one. */
  levels: readonly number[];
  takes: number;
  /** Balance between cues, before the person's volume. */
  gain: number;
  render: (rng: Rng, level: number) => Signal;
}

/**
 * The mix is deliberately quiet and even: what was asked for is a sound that
 * accompanies, never one that startles. Every take is normalized, and the
 * strength of an event moves its loudness only a little (see `loudness`);
 * what a hard hit has is a brighter, sharper sound, not a much louder one.
 */
export const CUES: Record<SoundCue, CueSpec> = {
  hit: { levels: [0.15, 0.4, 0.65, 1], takes: 3, gain: 0.8, render: (rng, p) => racketHit(SFX_RATE, rng, p, CHOSEN.racket) },
  bounce: { levels: [0.3, 0.6, 0.9], takes: 3, gain: 0.42, render: (rng, v) => bounce(SFX_RATE, rng, v, CHOSEN.turf) },
  glass: { levels: [0.4, 0.85], takes: 2, gain: 0.55, render: (rng, v) => glass(SFX_RATE, rng, v, CHOSEN.glass) },
  fence: { levels: [0.4, 0.85], takes: 2, gain: 0.45, render: (rng, v) => fence(SFX_RATE, rng, v, CHOSEN.fence) },
  net: { levels: [0.7], takes: 2, gain: 0.45, render: (rng, v) => net(SFX_RATE, rng, v, false, CHOSEN.net) },
  netCord: { levels: [0.7], takes: 2, gain: 0.4, render: (rng, v) => net(SFX_RATE, rng, v, true, CHOSEN.net) },
  step: { levels: [1], takes: 4, gain: 0.12, render: (rng) => feet(SFX_RATE, rng, 'step', CHOSEN.feet) },
  split: { levels: [1], takes: 2, gain: 0.14, render: (rng) => feet(SFX_RATE, rng, 'split', CHOSEN.feet) },
  slide: { levels: [1], takes: 2, gain: 0.16, render: (rng) => feet(SFX_RATE, rng, 'slide', CHOSEN.feet) },
  swing: { levels: [1], takes: 2, gain: 0.22, render: (rng) => swing(SFX_RATE, rng, 1, SWING_LEAD) },
};

/** How much louder a strong event is than a weak one: about 5 dB from end to end. */
export function loudness(intensity: number): number {
  return 0.55 + 0.45 * Math.min(1, Math.max(0, intensity));
}

/** The rendered strength closest to `intensity`. */
export function nearestLevel(cue: SoundCue, intensity: number): number {
  const levels = CUES[cue].levels;
  let best = 0;
  for (let i = 1; i < levels.length; i++) {
    if (Math.abs(levels[i]! - intensity) < Math.abs(levels[best]! - intensity)) best = i;
  }
  return best;
}

export interface Take {
  cue: SoundCue;
  level: number;
  take: number;
}

/** Every take the game uses, in the order they are rendered: the common ones first. */
export function allTakes(): Take[] {
  const order: SoundCue[] = ['hit', 'bounce', 'glass', 'fence', 'net', 'netCord', 'step', 'split', 'slide', 'swing'];
  const list: Take[] = [];
  for (const cue of order) {
    const spec = CUES[cue];
    for (let take = 0; take < spec.takes; take++) {
      for (let level = 0; level < spec.levels.length; level++) list.push({ cue, level, take });
    }
  }
  return list;
}

export function takeKey(t: Take): string {
  return `${t.cue}/${t.level}/${t.take}`;
}

/** One take, dry and mono at SFX_RATE, peaking at 0.9. */
export function renderTake(t: Take): Signal {
  const spec = CUES[t.cue];
  const rng = new Rng(1 + t.take * 7919 + t.level * 104729 + t.cue.length * 31);
  return normalize(trim(spec.render(rng, spec.levels[t.level]!), 2e-4), 0.9);
}

/**
 * The court's air, as an impulse response for a convolver: glass at both
 * ends, mesh at the sides, open sky. Short and bright. Stereo.
 */
export function courtImpulse(sr: number): [Signal, Signal] {
  const impulse = new Float32Array(Math.ceil(sr * 0.01));
  impulse[0] = 1;
  const [l, r] = room(sr, impulse, { rt60: 0.5, size: 0.9, damp: 3800, predelay: 0.012 }, 0.5);
  // The glass behind: one clear early reflection, a little apart on each side.
  l[Math.round(sr * 0.017)]! += 0.35;
  r[Math.round(sr * 0.021)]! += 0.3;
  return [l, r];
}
