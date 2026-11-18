/**
 * Every sound, by name, as a render function: first the takes the game plays
 * (the versions chosen on the board), then the versions that were not chosen
 * (still on the board, to compare), then the club. `npm run sounds` and the
 * tests walk this list.
 */
import { Rng } from '../core/rng';
import { allTakes, CUES, renderTake, SFX_RATE } from './bank';
import { AMBIENCE_STYLES, bed, bird, clink, nextCourt, type BirdKind } from './synth/ambience';
import type { Signal } from './synth/dsp';
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
  TURF_STYLES,
  type StepKind,
} from './synth/impacts';

export interface CatalogueItem {
  name: string;
  /** Sample rate of what `render` returns. */
  sr: number;
  render: () => Signal | Signal[];
}

/** Seconds of club bed in the catalogue, as long as the game's loop. */
const BED_SAMPLE = 14;

export function catalogue(sr = SFX_RATE): CatalogueItem[] {
  const items: CatalogueItem[] = [];
  const add = (name: string, render: () => Signal | Signal[], rate = sr) => items.push({ name, sr: rate, render });

  for (const take of allTakes()) {
    const level = CUES[take.cue].levels[take.level]!;
    add(`game-${take.cue}-${level}-${take.take}`, () => renderTake(take), SFX_RATE);
  }

  for (const [id, style] of Object.entries(RACKET_STYLES)) {
    for (const [label, power] of [
      ['soft', 0.15],
      ['normal', 0.5],
      ['hard', 1],
    ] as const) {
      add(`board-hit-${id}-${label}`, () => racketHit(sr, new Rng(11), power, style));
    }
  }
  for (const [id, style] of Object.entries(TURF_STYLES)) {
    add(`board-bounce-${id}-soft`, () => bounce(sr, new Rng(3), 0.3, style));
    add(`board-bounce-${id}-hard`, () => bounce(sr, new Rng(3), 0.9, style));
  }
  for (const [id, style] of Object.entries(GLASS_STYLES)) add(`board-glass-${id}`, () => glass(sr, new Rng(7), 0.8, style));
  for (const [id, style] of Object.entries(FENCE_STYLES)) add(`board-fence-${id}`, () => fence(sr, new Rng(9), 0.8, style));
  for (const [id, style] of Object.entries(NET_STYLES)) {
    add(`board-net-${id}`, () => net(sr, new Rng(13), 0.7, false, style));
    add(`board-netcord-${id}`, () => net(sr, new Rng(13), 0.7, true, style));
  }
  for (const [id, style] of Object.entries(FEET_STYLES)) {
    for (const kind of ['step', 'split', 'slide', 'squeak'] as StepKind[]) {
      add(`board-feet-${id}-${kind}`, () => feet(sr, new Rng(17), kind, style));
    }
  }

  for (const [id, style] of Object.entries(AMBIENCE_STYLES)) add(`club-bed-${id}`, () => bed(sr, 7, BED_SAMPLE, style));
  for (const kind of ['thrush', 'kiskadee', 'sparrows', 'dove'] as BirdKind[]) {
    for (const take of [0, 1]) add(`club-bird-${kind}-${take}`, () => bird(sr, 1000 + take * 17, kind));
  }
  add('club-clink', () => clink(sr, 1000));
  add('club-next-court', () => nextCourt(sr, 1034));
  return items;
}
