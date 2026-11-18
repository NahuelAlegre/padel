/**
 * Listens to the match and says what should sound, where and how hard. It
 * reads the simulation and never touches it: no generator of its own is
 * shared with it, nothing it does changes a rally or a replay.
 *
 * Two sources: the simulation's events (hits, bounces, walls, the net), and
 * the players' movement, looked at once per frame (footsteps, the split step
 * as the opponent hits, the braking scrape, the swing of a smash).
 */
import type { Sound, SoundCue } from '../platform/types';
import type { Match, SimEvent } from '../sim/match';
import type { ShotKind } from '../sim/types';
import { SWING_LEAD } from './bank';

/** Shots that are a whole-arm swing over the head: they are heard coming. */
const OVERHEAD: ReadonlySet<ShotKind> = new Set<ShotKind>(['smash', 'vibora']);
/** Below these speeds (m/s) the ball is rolling or dribbling: no sound. */
const MIN_BOUNCE = 1.2;
const MIN_WALL = 1.5;
/** Two bounces closer than this are one sound. */
const BOUNCE_GAP = 0.06;
/** A player runs from this speed (m/s), and takes a step every stride (m). */
const RUN = 1.3;
const STRIDE = 1.05;
/** A brake: from at least this speed, down to a near stop. */
const BRAKE_FROM = 3.6;
const BRAKE_TO = 1.2;
/** Pan is kept narrow: the court is in front of the person, not around them. */
const PAN_WIDTH = 0.55;

interface Feet {
  distance: number;
  /** Highest speed in the last moments, to notice a brake. */
  recentTop: number;
  lastSlide: number;
  /** Contact time of the swing already heard. */
  swungFor: number;
}

export class SoundDirector {
  private feet: Feet[] = [];
  private lastTime = -1;
  private lastBounce = -1;

  constructor(private readonly sound: Sound) {}

  /** A new match or lesson: forget the old one. */
  reset(): void {
    this.feet = [];
    this.lastTime = -1;
    this.lastBounce = -1;
  }

  onEvent(event: SimEvent, match: Match): void {
    switch (event.type) {
      case 'hit': {
        this.at(match, 'hit', event.x, event.y, hitIntensity(event.kind, event.speed));
        // The other side does its split step as the ball is struck.
        if (match.phase === 'rally' || match.phase === 'windup') {
          for (const p of match.players) {
            if (p.team !== event.team && Math.hypot(p.vx, p.vy) < 1.5) this.at(match, 'split', p.x, p.y, 0.5);
          }
        }
        break;
      }
      case 'bounce':
        if (event.speed < MIN_BOUNCE || match.time - this.lastBounce < BOUNCE_GAP) break;
        this.lastBounce = match.time;
        this.at(match, 'bounce', event.x, event.y, clamp01(event.speed / 11));
        break;
      case 'wall':
        if (event.speed < MIN_WALL) break;
        this.at(match, event.surface === 'glass' ? 'glass' : 'fence', event.x, event.y, clamp01(event.speed / 16));
        break;
      case 'net':
        this.at(match, event.cord ? 'netCord' : 'net', event.x, 0, 0.7);
        break;
      default:
        break;
    }
  }

  /** Once per frame, after the match has moved. `speed` is the game's speed setting. */
  update(match: Match, speed = 1): void {
    const now = match.time;
    const dt = now - this.lastTime;
    this.lastTime = now;
    if (dt <= 0 || dt > 0.25) return;
    const moving = match.phase === 'rally' || match.phase === 'windup';
    match.players.forEach((p, i) => {
      const f = (this.feet[i] ??= { distance: 0, recentTop: 0, lastSlide: -1, swungFor: -1 });
      const v = Math.hypot(p.vx, p.vy);
      // The top speed fades over about a quarter of a second.
      f.recentTop = Math.max(v, f.recentTop - dt * 14);
      if (moving && v > RUN) {
        f.distance += v * dt;
        if (f.distance >= STRIDE) {
          f.distance -= STRIDE;
          this.at(match, 'step', p.x, p.y, clamp01(v / 6));
        }
      } else {
        f.distance = STRIDE * 0.6;
      }
      if (moving && f.recentTop > BRAKE_FROM && v < BRAKE_TO && now - f.lastSlide > 0.6) {
        f.lastSlide = now;
        f.recentTop = v;
        this.at(match, 'slide', p.x, p.y, 0.6);
      }
      // The swing of a smash is heard before the contact.
      const anim = p.anim;
      if (anim.kind === 'swing' && OVERHEAD.has(anim.shot) && Number.isFinite(anim.contactAt) && f.swungFor !== anim.contactAt) {
        const remaining = (anim.contactAt - now) / Math.max(0.1, speed);
        if (remaining > 0 && remaining <= SWING_LEAD) {
          f.swungFor = anim.contactAt;
          this.at(match, 'swing', p.x, p.y, 1, SWING_LEAD - remaining);
        }
      }
    });
  }

  private at(match: Match, cue: SoundCue, x: number, y: number, intensity: number, offset = 0): void {
    const court = match.config.court;
    this.sound.play(cue, {
      intensity,
      pan: clamp(x / court.halfWidth, -1, 1) * PAN_WIDTH,
      // The person's end of the court (negative y) is the near one.
      depth: clamp01((y + court.halfLength) / (2 * court.halfLength)),
      offset,
    });
  }
}

/**
 * How hard a hit sounds. The speed says most of it, the shot the rest: a
 * chiquita or a globo is a touch however fast it leaves, the underhand serve
 * is never a blow, and a smash always is.
 */
export function hitIntensity(kind: ShotKind, speed: number): number {
  let i = clamp01((speed - 8) / 20);
  if (kind === 'lob' || kind === 'drop') i = Math.min(i, 0.18);
  else if (kind === 'serve') i = Math.min(i, 0.4);
  else if (kind === 'smash') i = Math.max(i, 0.85);
  else if (kind === 'vibora') i = Math.max(i, 0.65);
  return i;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
