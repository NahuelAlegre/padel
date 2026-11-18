import type { AILevel } from '../config';
import { clamp, lerp } from '../core/math';
import type { Character } from './types';

/**
 * What the stars buy: how well a rival plays padel, whoever it is. Each row
 * is the value at one, three and five stars.
 *
 * None of it is running faster or hitting harder than a person. A better
 * rival reads the point, finishes the ball that is there to be attacked,
 * takes the net and holds it, has steadier hands and is harder to rattle.
 */
const EDGE = {
  /** How often it picks the shot the situation asks for. */
  smart: [0.2, 0.65, 0.92],
  /** How often it finishes a ball that is there to be attacked. */
  punish: [0.1, 0.55, 0.9],
  /** How often it goes to the net behind a lob or a chiquita, and how much it holds it. */
  net: [0.1, 0.5, 0.85],
  /** Spread of its timing, in seconds, and of its shots. */
  timingSigma: [0.2, 0.1, 0.06],
  errorScale: [1.5, 1.1, 0.9],
  /** How little a run of difficult balls gets to it. */
  composure: [0.2, 0.6, 0.9],
  /** Seconds before it starts moving to a new ball. */
  reaction: [0.45, 0.28, 0.18],
  /** Its legs, always inside what a person has. */
  speedFactor: [0.75, 0.9, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

/**
 * How far a taste of the style moves a number away from what the stars give.
 * A taste is 0..1 with 0.5 as "nothing special": all the way to one end is
 * worth this many stars, up or down.
 */
const LEAN = 2;

/** One number of the table for a character: its stars, shifted by a taste of its style. */
function edge(row: readonly [number, number, number], stars: number, taste: number): number {
  const at = clamp((stars - 1 + (taste - 0.5) * 2 * LEAN) / 4, 0, 1);
  return at <= 0.5 ? lerp(row[0], row[1], at * 2) : lerp(row[1], row[2], at * 2 - 1);
}

/**
 * Turns a character into the numbers the computer player runs on.
 *
 * The stars give the edge (how well it plays, see `EDGE`) and the style gives
 * the shape: what it likes to do, and where it is a little better or worse
 * than its stars say. The traits add the few behaviours that make it somebody.
 *
 * `firstMatch` is the first match ever against this character: a coach feeds
 * more balls to somebody he has just met.
 */
export function toAILevel(character: Character, firstMatch = false): AILevel {
  const style = character.style;
  const stars = character.stars;
  const level: AILevel = {
    reaction: edge(EDGE.reaction, stars, style.reading),
    speedFactor: edge(EDGE.speedFactor, stars, style.speed),
    timingSigma: edge(EDGE.timingSigma, stars, 1 - style.errors),
    errorScale: edge(EDGE.errorScale, stars, style.precision),
    // Nobody misses for no reason: errors come from pressure, risk and not getting there.
    mishit: 0,
    smart: edge(EDGE.smart, stars, style.reading),
    punish: edge(EDGE.punish, stars, style.aggression),
    netRush: edge(EDGE.net, stars, style.netLean),
    holdNet: edge(EDGE.net, stars, style.netLean),
    composure: edge(EDGE.composure, stars, style.composure),
    lobChance: style.lob * 0.45,
    dropChance: style.drop * 0.22,
    serveDelay: lerp(1.4, 0.8, style.aggression),
    power: lerp(0.84, 1.14, style.power),
    wallBias: (style.wallUse - 0.5) * 1.2,
    angle: style.angle,
    aggression: style.aggression,
    feed: 0,
    impatientAfter: Infinity,
    impatience: 0,
    wallScatter: 1,
    lobUnderPressure: false,
    tellLead: character.tell.lead,
  };
  for (const trait of character.traits) {
    switch (trait.kind) {
      case 'feeder':
        level.feed = firstMatch ? trait.firstMatchChance : trait.chance;
        break;
      case 'impatient':
        level.impatientAfter = trait.afterHits;
        level.impatience = trait.strainPerHit;
        break;
      case 'wallWeak':
        level.wallScatter = 1 / trait.precisionFactor;
        break;
      case 'lobUnderPressure':
        level.lobUnderPressure = true;
        break;
    }
  }
  return level;
}
