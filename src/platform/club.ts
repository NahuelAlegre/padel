/**
 * The club around the court, playing: the bed loops under everything and the
 * events (birds, the next court, a glass at the buffet) fall at random
 * moments, so the whole never repeats. All of it at a low rate and on its own
 * bus.
 *
 * Rendering is split into small steps (`prepare`), so it can be done in the
 * gaps between frames before anything plays.
 */
import { Rng } from '../core/rng';
import { room, type Signal } from '../audio/synth/dsp';
import { AMBIENCE_STYLES, bed, bird, clink, nextCourt, type AmbienceStyleId, type BirdKind } from '../audio/synth/ambience';
import type { AudioEngine } from './audio';

/** The club does not need more than this: its highest sounds are leaves and sparrows. */
export const AMBIENCE_RATE = 22050;
/** Seconds of bed before it loops. Long enough that its gusts are not remembered. */
export const BED_SECONDS = 14;

type EventKind = BirdKind | 'rally' | 'clink';

const TAKES: Record<EventKind, number> = { thrush: 3, kiskadee: 2, sparrows: 3, dove: 2, rally: 2, clink: 3 };

/** Peak level of each kind of event, before the person's volume. */
const LEVEL: Record<EventKind, number> = { thrush: 0.22, kiskadee: 0.18, sparrows: 0.15, dove: 0.28, rally: 0.5, clink: 0.1 };

export class ClubAmbience {
  private bedData: [Signal, Signal] | null = null;
  private bedBuffer: AudioBuffer | null = null;
  private readonly eventData = new Map<string, [Signal, Signal]>();
  private readonly eventBuffers = new Map<string, AudioBuffer>();
  private readonly pending: string[] = [];
  private stopBed: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly rng = new Rng(20261118);
  private running = false;

  constructor(
    private readonly engine: AudioEngine,
    readonly style: AmbienceStyleId,
  ) {
    for (const kind of Object.keys(TAKES) as EventKind[]) {
      if (this.rate(kind) <= 0) continue;
      for (let take = 0; take < TAKES[kind]; take++) this.pending.push(`${kind}/${take}`);
    }
  }

  get playing(): boolean {
    return this.running;
  }

  /** Renders one more piece. Returns false once everything is ready. */
  prepare(): boolean {
    if (!this.bedData) {
      this.bedData = bed(AMBIENCE_RATE, 7, BED_SECONDS, AMBIENCE_STYLES[this.style]);
      return true;
    }
    const key = this.pending.shift();
    if (!key) return false;
    const [kind, take] = key.split('/') as [EventKind, string];
    this.eventData.set(key, renderEvent(kind, 1000 + Number(take) * 17));
    return this.pending.length > 0;
  }

  /** Starts the bed and the events. Renders whatever is still missing of the bed. */
  start(gain = 1): void {
    if (this.running || !this.engine.ready) return;
    while (!this.bedData) this.prepare();
    this.bedBuffer ??= this.engine.buffer(this.bedData, AMBIENCE_RATE);
    this.running = true;
    this.stopBed = this.engine.loop(this.bedBuffer, 'ambience', gain, 3);
    for (const kind of Object.keys(TAKES) as EventKind[]) {
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

  /** Events per minute of a kind, in this style. */
  private rate(kind: EventKind): number {
    const style = AMBIENCE_STYLES[this.style];
    if (kind === 'rally') return style.rally;
    if (kind === 'clink') return style.clinks;
    const index = ['thrush', 'kiskadee', 'sparrows', 'dove'].indexOf(kind);
    const mix = style.birdMix;
    return (style.birds * mix[index]!) / (mix[0] + mix[1] + mix[2] + mix[3]);
  }

  private schedule(kind: EventKind, first: boolean): void {
    // Random gaps (exponential, as in nature), never closer than a few seconds.
    const mean = 60 / this.rate(kind);
    const wait = first ? this.rng.range(1.5, Math.min(8, mean)) : Math.max(3, -Math.log(1 - this.rng.next()) * mean);
    const timer = setTimeout(() => {
      if (!this.running) return;
      this.fire(kind);
      this.schedule(kind, false);
    }, wait * 1000);
    this.timers.push(timer);
  }

  private fire(kind: EventKind): void {
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
      gain: LEVEL[kind] * this.rng.range(0.6, 1.1),
      pan: this.rng.range(-0.85, 0.85),
      priority: 0,
    });
  }
}

/** One event, placed in the open air around the court. Stereo. */
function renderEvent(kind: EventKind, seed: number): [Signal, Signal] {
  const dry =
    kind === 'rally' ? nextCourt(AMBIENCE_RATE, seed) : kind === 'clink' ? clink(AMBIENCE_RATE, seed) : bird(AMBIENCE_RATE, seed, kind);
  // Birds sit in the trees around the club; the buffet and the next court are behind glass.
  const [l, r] = room(AMBIENCE_RATE, dry, { rt60: kind === 'rally' ? 0.9 : 0.6, size: 1.4, damp: 2600, predelay: 0.03 }, 0.8);
  const direct = kind === 'rally' ? 0.5 : 0.8;
  for (let i = 0; i < dry.length; i++) {
    l[i]! += dry[i]! * direct;
    r[i]! += dry[i]! * direct;
  }
  return [l, r];
}
