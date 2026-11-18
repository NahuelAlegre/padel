/**
 * Every sound the game can make, by name, as a render function. The WAV
 * script (`npm run sounds`) and the tests walk this list; the game itself
 * renders only the variants it uses.
 */
import { CHARACTER_IDS } from '../characters/cast';
import { Rng } from '../core/rng';
import { UTTERANCES, VOICES, type Reaction, type VoiceStyle } from './people';
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
  type StepKind,
} from './synth/impacts';
import { say } from './synth/voice';
import { AMBIENCE_STYLES, bed, bird, clink, laugh, nextCourt, type BirdKind } from './synth/ambience';
import { BED_SECONDS } from './club';
import type { Signal } from './synth/dsp';

export interface CatalogueItem {
  name: string;
  render: () => Signal | Signal[];
}

export function catalogue(sr: number): CatalogueItem[] {
  const items: CatalogueItem[] = [];
  const add = (name: string, render: () => Signal | Signal[]) => items.push({ name, render });

  for (const [id, style] of Object.entries(RACKET_STYLES)) {
    for (const [label, power] of [
      ['soft', 0.15],
      ['normal', 0.5],
      ['hard', 1],
    ] as const) {
      add(`hit-${id}-${label}`, () => racketHit(sr, new Rng(11), power, style));
    }
  }
  add('swing-hard', () => swing(sr, new Rng(5), 1));
  for (const [id, style] of Object.entries(TURF_STYLES)) {
    add(`bounce-${id}-soft`, () => bounce(sr, new Rng(3), 0.3, style));
    add(`bounce-${id}-hard`, () => bounce(sr, new Rng(3), 0.9, style));
  }
  for (const [id, style] of Object.entries(GLASS_STYLES)) add(`glass-${id}`, () => glass(sr, new Rng(7), 0.8, style));
  for (const [id, style] of Object.entries(FENCE_STYLES)) add(`fence-${id}`, () => fence(sr, new Rng(9), 0.8, style));
  for (const [id, style] of Object.entries(NET_STYLES)) {
    add(`net-${id}`, () => net(sr, new Rng(13), 0.7, false, style));
    add(`netcord-${id}`, () => net(sr, new Rng(13), 0.7, true, style));
  }
  for (const [id, style] of Object.entries(FEET_STYLES)) {
    for (const kind of ['step', 'split', 'slide', 'squeak'] as StepKind[]) {
      add(`feet-${id}-${kind}`, () => feet(sr, new Rng(17), kind, style));
    }
  }
  for (const who of CHARACTER_IDS) {
    for (const style of ['words', 'murmur', 'sounds'] as VoiceStyle[]) {
      for (const reaction of ['win', 'lose', 'effort', 'hello', 'laugh'] as Reaction[]) {
        UTTERANCES[who][style][reaction].forEach((line, i) => {
          add(`voice-${who}-${style}-${reaction}-${i}`, () => say(sr, 100 + i, line.text, VOICES[who], line.opts));
        });
      }
    }
  }
  // The game plays the club at a lower rate; here it is rendered at `sr` like the rest.
  for (const [id, style] of Object.entries(AMBIENCE_STYLES)) add(`club-bed-${id}`, () => bed(sr, 7, BED_SECONDS, style));
  for (const kind of ['thrush', 'kiskadee', 'sparrows', 'dove'] as BirdKind[]) {
    for (const take of [0, 1]) add(`club-bird-${kind}-${take}`, () => bird(sr, 1000 + take * 17, kind));
  }
  add('club-clink', () => clink(sr, 1000));
  add('club-laugh', () => laugh(sr, 1017));
  add('club-next-court', () => nextCourt(sr, 1034));
  return items;
}
