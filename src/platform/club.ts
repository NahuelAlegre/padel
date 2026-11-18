/**
 * The club around the court, playing: the bed loops under everything and the
 * events (birds, the next court, a glass at the buffet) fall at random
 * moments, so the whole never repeats. All of it at a low rate and on its own
 * bus, well in the background.
 *
 * Rendering is split into small steps (`prepare`), a couple of milliseconds
 * each, so it is done in the gaps between frames and never holds up a touch.
 * The club starts once its bed is ready, not before.
 */
import { Rng } from '../core/rng';
import { filter, finish, roomSteps, type Signal, type Steps } from '../audio/synth/dsp';
import { AMBIENCE_STYLES, bedSteps, bird, clink, nextCourtSteps, type AmbienceStyleId, type BirdKind } from '../audio/synth/ambience';
import type { AudioEngine } from './audio';

/** The club does not need more than this: its highest sounds are leaves and sparrows. */
export const AMBIENCE_RATE = 22050;
/** Seconds of bed before it loops. Long enough that its gusts are not remembered. */
export const BED_SECONDS = 14;

export type ClubEvent = BirdKind | 'rally' | 'clink';

const TAKES: Record<ClubEvent, number> = { thrush: 3, kiskadee: 2, sparrows: 3, dove: 2, rally: 2, clink: 3 };

/**
 * Peak level of each kind of event, before the person's volume. The birds sit
 * far under the hits: a whistle is a held tone, and next to a hit, which is
 * over in a few milliseconds, it sounds much louder than its peak says,
 * all the more on a phone speaker, which plays 2 to 4 kHz best. The kiskadee
 * and the sparrows, the shrillest, a little lower still.
 */
export const EVENT_LEVEL: Record<ClubEvent, number> = {
  thrush: 0.036,
  kiskadee: 0.026,
  sparrows: 0.05,
  dove: 0.063,
  rally: 0.5,
  clink: 0.07,
};

/** Birds are far, in the trees around the club: the air takes the edge off their highs. */
const BIRD_AIR = 5000;

export class ClubAmbience {
  private bedData: [Signal, Signal] | null = null;
  private bedBuffer: AudioBuffer | null = null;
  private readonly eventData = new Map<string, [Signal, Signal]>();
  private readonly eventBuffers = new Map<string, AudioBuffer>();
  private readonly work: Steps<void>;
  private stopBed: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly rng = new Rng(20261118);
  private running = false;

  constructor(
    private readonly engine: AudioEngine,
    readonly style: AmbienceStyleId,
  ) {
    this.work = this.render();
  }

  get playing(): boolean {
    return this.running;
  }

  /** The bed is ready: the club can start. */
  get ready(): boolean {
    return this.bedData !== null;
  }

  /** Does one more small step of rendering. Returns false once everything is ready. */
  prepare(): boolean {
    return !this.work.next().done;
  }

  /** Starts the bed and the events, once the bed is ready; until then, nothing. */
  start(gain = 1): void {
    if (this.running || !this.engine.ready || !this.bedData) return;
    this.bedBuffer ??= this.engine.buffer(this.bedData, AMBIENCE_RATE);
    this.running = true;
    this.stopBed = this.engine.loop(this.bedBuffer, 'ambience', gain, 3);
    for (const kind of Object.keys(TAKES) as ClubEvent[]) {
      if (this.rate(kind) > 0) this.schedule(kind, true);
    }
  }

  stop(): void {
    this.running = false;
    this.stopBed?.();
    this.stopBed = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** The bed first, then the events one take at a time. */
  private *render(): Steps<void> {
    this.bedData = yield* bedSteps(AMBIENCE_RATE, 7, BED_SECONDS, AMBIENCE_STYLES[this.style]);
    for (const kind of Object.keys(TAKES) as ClubEvent[]) {
      if (this.rate(kind) <= 0) continue;
      for (let take = 0; take < TAKES[kind]; take++) {
        yield;
        this.eventData.set(`${kind}/${take}`, yield* clubEventSteps(kind, 1000 + take * 17));
      }
    }
  }

  /** Events per minute of a kind, in this style. */
  private rate(kind: ClubEvent): number {
    const style = AMBIENCE_STYLES[this.style];
    if (kind === 'rally') return style.rally;
    if (kind === 'clink') return style.clinks;
    const index = ['thrush', 'kiskadee', 'sparrows', 'dove'].indexOf(kind);
    const mix = style.birdMix;
    return (style.birds * mix[index]!) / (mix[0] + mix[1] + mix[2] + mix[3]);
  }

  private schedule(kind: ClubEvent, first: boolean): void {
    // Random gaps (exponential, as in nature), never closer than a few seconds.
    // The first one anywhere in a usual gap: the club does not all start at once.
    const mean = 60 / this.rate(kind);
    const wait = first ? this.rng.range(3, Math.max(3, mean)) : Math.max(3, -Math.log(1 - this.rng.next()) * mean);
    const timer = setTimeout(() => {
      if (!this.running) return;
      this.fire(kind);
      this.schedule(kind, false);
    }, wait * 1000);
    this.timers.push(timer);
  }

  private fire(kind: ClubEvent): void {
    // Only what is already rendered: nothing is rendered in the middle of a rally.
    const ready = [...this.eventData.keys()].filter((k) => k.startsWith(`${kind}/`));
    if (ready.length === 0) return;
    const key = ready[Math.floor(this.rng.next() * ready.length)]!;
    let buffer = this.eventBuffers.get(key);
    if (!buffer) {
      buffer = this.engine.buffer(this.eventData.get(key)!, AMBIENCE_RATE) ?? undefined;
      if (!buffer) return;
      this.eventBuffers.set(key, buffer);
    }
    this.engine.play(buffer, {
      bus: 'ambience',
      gain: EVENT_LEVEL[kind] * this.rng.range(0.6, 1.1),
      pan: this.rng.range(-0.85, 0.85),
      priority: 0,
    });
  }
}

/** One event, placed in the open air around the court, stereo, before its level. */
export function clubEvent(kind: ClubEvent, seed: number): [Signal, Signal] {
  return finish(clubEventSteps(kind, seed));
}

function* clubEventSteps(kind: ClubEvent, seed: number): Steps<[Signal, Signal]> {
  const dry =
    kind === 'rally' ? yield* nextCourtSteps(AMBIENCE_RATE, seed) : kind === 'clink' ? clink(AMBIENCE_RATE, seed) : bird(AMBIENCE_RATE, seed, kind);
  if (kind !== 'rally' && kind !== 'clink') filter(AMBIENCE_RATE, dry, 'lowpass', BIRD_AIR, 0.6);
  yield;
  // Birds sit in the trees around the club; the buffet and the next court are behind glass.
  const [l, r] = yield* roomSteps(AMBIENCE_RATE, dry, { rt60: kind === 'rally' ? 0.9 : 0.6, size: 1.4, damp: 2600, predelay: 0.03 }, 0.8);
  const direct = kind === 'rally' ? 0.5 : 0.8;
  for (let i = 0; i < dry.length; i++) {
    l[i]! += dry[i]! * direct;
    r[i]! += dry[i]! * direct;
  }
  return [l, r];
}
