import { CAST } from '../characters/cast';
import { CHARACTER_TEXT } from '../characters/lines.es';
import type { Character, CharacterId, Line, Lines, PointTag } from '../characters/types';
import type { Rng } from '../core/rng';
import type { SceneAct } from '../render/scene';
import type { Match, SimEvent } from '../sim/match';
import type { PointReason } from '../sim/rules';
import { isGoldenPoint } from '../sim/score';
import type { ShotKind, TeamId } from '../sim/types';
import type { LineFrequency } from '../ui/settings';
import type { RivalRecord } from './persistence';

/** Seconds a speech bubble stays up, unless the serve closes it first. */
export const BUBBLE_SECONDS = 1.2;
/** From this many hits a rally is worth a comment. */
const LONG_RALLY = 9;
/** A point this short, with nothing special in it, is routine. */
const ROUTINE_RALLY = 3;
/** A line is not said again until this many others have been. */
const REMEMBER_LINES = 8;
/** After this many days without playing, the character has missed you. */
const LONG_TIME_DAYS = 14;
/** How often the character has a tic after a point, and how long after the point it starts. */
const MANNERISM_CHANCE = 0.6;
const MANNERISM_DELAY = 0.2;
/** With six matches or more and a difference of one at most, it is a classic. */
const CLASSIC_MATCHES = 6;

/** What the character does about something that just happened. */
export interface Reaction {
  /** A line for its speech bubble. */
  say?: string;
  /** Whatever it was saying or doing is over. */
  hush?: boolean;
}

const HUSH: Reaction = { hush: true };

/** Whole days from one yyyy-mm-dd date to another. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : 0;
}

/** Adds a finished match to the history with a rival. */
export function noteMatch(record: RivalRecord, won: boolean, today: string): void {
  record.played++;
  record.lastPlayed = today;
  if (won) {
    record.wins++;
    record.streak = record.streak > 0 ? record.streak + 1 : 1;
  } else {
    record.losses++;
    record.streak = record.streak < 0 ? record.streak - 1 : -1;
  }
}

/** A rival the person has played a lot and evenly against. A distinction: it changes nothing. */
export function isClassic(record: RivalRecord | undefined): boolean {
  return !!record && record.played >= CLASSIC_MATCHES && Math.abs(record.wins - record.losses) <= 1;
}

/** It gives its tell away once, to somebody it has beaten three times running or who never beat it in three. */
function owesHint(record: RivalRecord): boolean {
  return !record.hintShown && (record.streak <= -3 || (record.wins === 0 && record.losses >= 3));
}

/**
 * Everything about a rival that is not playing: what it says and the tics it
 * has between points. It listens to what happens in the match and never
 * touches it: nothing here delays a serve or changes a rally, and its dice are
 * not the dice of the simulation, so turning the lines off or changing how
 * often they come leaves a match, and its replay, exactly as they were.
 *
 * At most one bubble at a time, about a third of the points, more after a
 * point worth talking about, never three points running and never a line that
 * was said a moment ago.
 */
export class Personality {
  /** How often it speaks. Can change in the middle of a match. */
  frequency: LineFrequency = 'many';

  private character: Character | null = null;
  private lines: Lines | null = null;
  private team: TeamId = 1;
  private readonly recent: string[] = [];
  private spokeInARow = 0;
  private points = 0;
  private golden = false;

  // The point in progress.
  private hits = 0;
  private lastHit: ShotKind | null = null;
  private wallSinceHit = false;

  // The tic in progress.
  private readonly act: SceneAct = { clip: 'cap', t: 0, duration: 0 };
  private actFrom = -1;

  constructor(
    /** For presentation only: never the generator of the simulation. */
    private readonly rng: Rng,
  ) {}

  /** The character on court, or null when nobody with a personality is playing. */
  get who(): Character | null {
    return this.character;
  }

  /** Nobody to speak for (the demo, the menu). */
  clear(): void {
    this.character = null;
    this.lines = null;
    this.actFrom = -1;
  }

  /**
   * A match against `id`, who plays on `team`, starts or goes on. Returns
   * what it says to open it: hello the first time, something else to somebody
   * it knows, or its tell to somebody it keeps beating (`hint`). With `greet`
   * off (a rematch on the spot, a match picked up again) it says nothing.
   */
  begin(
    id: CharacterId,
    team: TeamId,
    record: RivalRecord | undefined,
    today: string,
    greet: boolean,
  ): { line: string | null; hint: boolean } {
    this.character = CAST[id];
    this.lines = CHARACTER_TEXT[id].lines;
    this.team = team;
    this.recent.length = 0;
    this.spokeInARow = 0;
    this.points = 0;
    this.golden = false;
    this.hits = 0;
    this.lastHit = null;
    this.wallSinceHit = false;
    this.actFrom = -1;

    const lines = this.lines;
    if (!greet || this.frequency === 'none') return { line: null, hint: false };
    if (!record || record.played === 0) return { line: this.pick(lines.meetFirst, []), hint: false };
    if (owesHint(record)) return { line: this.pick(lines.hint, []), hint: true };
    const longTime = daysBetween(record.lastPlayed, today) >= LONG_TIME_DAYS;
    return { line: this.pick(longTime ? lines.meetLongTime : lines.meetAgain, []), hint: false };
  }

  /** What it says next to the rematch button. `won` is whether the person won. */
  rematchLine(won: boolean): string | null {
    const lines = this.lines;
    if (!lines || this.frequency === 'none') return null;
    return this.pick(won ? lines.rematchTheyLost : lines.rematchTheyWon, []);
  }

  /** Follows the match. Returns what the character does about it, if anything. */
  onEvent(event: SimEvent, match: Match): Reaction | null {
    const lines = this.lines;
    if (!lines) return null;
    switch (event.type) {
      case 'serveReady': {
        this.hits = 0;
        this.lastHit = null;
        this.wallSinceHit = false;
        // The golden point gets a line, once, when it comes up.
        const golden = isGoldenPoint(match.score, match.format);
        const comesUp = golden && !this.golden;
        this.golden = golden;
        if (comesUp && this.frequency !== 'none') {
          const line = this.pick(lines.goldenPoint, []);
          return line ? { say: line } : null;
        }
        return null;
      }
      case 'toss':
        // The serve closes the bubble and cuts the tic: nothing holds the game up.
        this.actFrom = -1;
        return HUSH;
      case 'hit':
        this.hits = match.rallyHits;
        this.lastHit = event.kind;
        this.wallSinceHit = false;
        return null;
      case 'wall':
        this.wallSinceHit = true;
        return null;
      case 'point':
        return this.afterPoint(event.winner === this.team, event.reason, match.time);
      case 'match':
        this.actFrom = -1;
        return HUSH;
      default:
        return null;
    }
  }

  /** The tic to show at simulation time `time`, or null. */
  actAt(time: number): SceneAct | null {
    if (this.actFrom < 0) return null;
    const t = time - this.actFrom;
    if (t < 0) return null;
    if (t >= this.act.duration) {
      this.actFrom = -1;
      return null;
    }
    this.act.t = t;
    return this.act;
  }

  private afterPoint(won: boolean, reason: PointReason, time: number): Reaction | null {
    const character = this.character;
    const lines = this.lines;
    if (!character || !lines) return null;
    this.points++;
    this.startAct(character, won, time);

    const tags = this.tags(reason);
    let chance = this.frequency === 'none' ? 0 : character.talk * (this.frequency === 'few' ? 0.4 : 1);
    if (tags.includes('longRally') || tags.includes('wall')) chance *= 1.8;
    if (this.hits <= ROUTINE_RALLY && tags.length === 0) chance *= 0.6;
    // Not after the first point (it has just said hello) and never three points running.
    const speaks = this.points > 1 && this.spokeInARow < 2 && this.rng.chance(chance);
    const line = speaks ? this.pick(won ? lines.winPoint : lines.losePoint, tags) : null;
    if (!line) {
      this.spokeInARow = 0;
      return null;
    }
    this.spokeInARow++;
    return { say: line };
  }

  /** What the point that just ended was like. */
  private tags(reason: PointReason): PointTag[] {
    const tags: PointTag[] = [];
    if (this.wallSinceHit || reason === 'wall' || reason === 'fence') tags.push('wall');
    if (this.lastHit === 'lob' || this.lastHit === 'smash' || this.lastHit === 'drop') tags.push(this.lastHit);
    if (reason === 'net' || reason === 'ownSide' || reason === 'wall' || reason === 'fence' || reason === 'out' || reason === 'doubleFault') {
      tags.push('error');
    }
    if (this.hits >= LONG_RALLY) tags.push('longRally');
    return tags;
  }

  /**
   * One line of the pool that fits the point and was not said a moment ago.
   * A line written for what just happened is three times as likely as one
   * that fits anything.
   */
  private pick(pool: readonly Line[], tags: readonly PointTag[]): string | null {
    let total = 0;
    const weights: number[] = [];
    for (const line of pool) {
      const text = typeof line === 'string' ? line : line.text;
      let weight = 1;
      if (typeof line !== 'string') weight = line.when.some((tag) => tags.includes(tag)) ? 3 : 0;
      if (this.recent.includes(text)) weight = 0;
      weights.push(weight);
      total += weight;
    }
    if (total <= 0) return null;
    let roll = this.rng.next() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) {
        const line = pool[i]!;
        const text = typeof line === 'string' ? line : line.text;
        this.recent.push(text);
        if (this.recent.length > REMEMBER_LINES) this.recent.shift();
        return text;
      }
    }
    return null;
  }

  private startAct(character: Character, won: boolean, time: number): void {
    this.actFrom = -1;
    if (!this.rng.chance(MANNERISM_CHANCE)) return;
    let total = 0;
    for (const mannerism of character.mannerisms) {
      if (fits(mannerism.when, won)) total += mannerism.weight;
    }
    if (total <= 0) return;
    let roll = this.rng.next() * total;
    for (const mannerism of character.mannerisms) {
      if (!fits(mannerism.when, won)) continue;
      roll -= mannerism.weight;
      if (roll < 0) {
        this.act.clip = mannerism.clip;
        this.act.duration = mannerism.duration;
        this.act.t = 0;
        this.actFrom = time + MANNERISM_DELAY;
        return;
      }
    }
  }
}

function fits(when: 'any' | 'afterWin' | 'afterLoss' | undefined, won: boolean): boolean {
  return when === undefined || when === 'any' || (when === 'afterWin') === won;
}
