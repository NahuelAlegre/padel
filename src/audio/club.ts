/**
 * The club around the court, playing: the bed loops under everything and the
 * events (birds, the next court, a glass, a laugh) fall at random moments, so
 * the whole never repeats. All of it at a low rate and on its own bus.
 */
import { Rng } from '../core/rng';
import type { AudioEngine } from './engine';
import { AMBIENCE_STYLES, bed, bird, clink, laugh, nextCourt, type AmbienceStyleId, type BirdKind } from './synth/ambience';
import { room, type Signal } from './synth/dsp';

/** The club does not need more than this: its highest sounds are leaves and sparrows. */
export const AMBIENCE_RATE = 22050;
/** Seconds of bed before it loops. Long enough that its gusts are not remembered. */
export const BED_SECONDS = 14;
/** Different takes of each event, rendered as they are first needed. */
const TAKES = 4;

type EventKind = BirdKind | 'rally' | 'clink' | 'laugh';

export class ClubAmbience {
  private stopBed: (() => void) | null = null;
  private timers: number[] = [];
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly rng = new Rng(20261118);
  private running = false;

  constructor(
    private readonly engine: AudioEngine,
    public style: AmbienceStyleId,
  ) {}

  get playing(): boolean {
    return this.running;
  }

  /** Renders the bed (about a tenth of a second of work) and starts everything. */
  start(gain = 1): void {
    if (this.running || !this.engine.ctx) return;
    this.running = true;
    const style = AMBIENCE_STYLES[this.style];
    const key = `bed-${this.style}`;
    let buffer = this.cache.get(key);
    if (!buffer) {
      const [l, r] = bed(AMBIENCE_RATE, 7, BED_SECONDS, style);
      buffer = this.engine.buffer([l, r], AMBIENCE_RATE) ?? undefined;
      if (buffer) this.cache.set(key, buffer);
    }
    this.stopBed = this.engine.loop(buffer ?? null, 'ambience', gain);
    const kinds: [EventKind, number][] = [
      ['thrush', (style.birds * style.birdMix[0]) / sum(style.birdMix)],
      ['kiskadee', (style.birds * style.birdMix[1]) / sum(style.birdMix)],
      ['sparrows', (style.birds * style.birdMix[2]) / sum(style.birdMix)],
      ['dove', (style.birds * style.birdMix[3]) / sum(style.birdMix)],
      ['rally', style.rally],
      ['clink', style.clinks],
      ['laugh', style.laughs],
    ];
    for (const [kind, perMinute] of kinds) if (perMinute > 0) this.schedule(kind, perMinute, true);
  }

  stop(): void {
    this.running = false;
    this.stopBed?.();
    this.stopBed = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private schedule(kind: EventKind, perMinute: number, first: boolean): void {
    // Poisson-like gaps, never closer than a few seconds, and soon after starting.
    const mean = 60 / perMinute;
    const wait = first ? this.rng.range(0.5, Math.min(6, mean)) : Math.max(2.5, -Math.log(1 - this.rng.next()) * mean);
    const timer = setTimeout(() => {
      if (!this.running) return;
      this.fire(kind);
      this.schedule(kind, perMinute, false);
    }, wait * 1000) as unknown as number;
    this.timers.push(timer);
  }

  private fire(kind: EventKind): void {
    const take = Math.floor(this.rng.next() * TAKES);
    const key = `${kind}-${take}`;
    let buffer = this.cache.get(key);
    if (!buffer) {
      const dry = render(kind, 1000 + take * 17);
      // Birds sit in the trees around the club; the buffet and the next court are behind glass.
      const [l, r] = room(AMBIENCE_RATE, dry, { rt60: kind === 'rally' ? 0.9 : 0.6, size: 1.4, damp: 2600, predelay: 0.03 }, 0.8);
      const dryGain = kind === 'rally' ? 0.5 : 0.8;
      for (let i = 0; i < dry.length; i++) {
        l[i]! += dry[i]! * dryGain;
        r[i]! += dry[i]! * dryGain;
      }
      buffer = this.engine.buffer([l, r], AMBIENCE_RATE) ?? undefined;
      if (!buffer) return;
      this.cache.set(key, buffer);
    }
    const level: Record<EventKind, number> = {
      thrush: 0.22,
      kiskadee: 0.2,
      sparrows: 0.16,
      dove: 0.3,
      rally: 0.55,
      clink: 0.12,
      laugh: 0.35,
    };
    this.engine.play(buffer, {
      bus: 'ambience',
      gain: level[kind] * this.rng.range(0.6, 1.1),
      pan: this.rng.range(-0.85, 0.85),
      priority: 0,
    });
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) || 1;
}

function render(kind: EventKind, seed: number): Signal {
  switch (kind) {
    case 'rally':
      return nextCourt(AMBIENCE_RATE, seed);
    case 'clink':
      return clink(AMBIENCE_RATE, seed);
    case 'laugh':
      return laugh(AMBIENCE_RATE, seed);
    default:
      return bird(AMBIENCE_RATE, seed, kind);
  }
}
