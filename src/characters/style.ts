import type { AILevel } from '../config';
import { lerp } from '../core/math';
import type { Character } from './types';

/**
 * Turns the way a character plays into the numbers the computer player runs
 * on. The style gives the shape (what it likes to do) and the edge (how well
 * it does it); the traits add the few behaviours that make it somebody.
 *
 * `firstMatch` is the first match ever against this character: a coach feeds
 * more balls to somebody he has just met.
 */
export function toAILevel(character: Character, firstMatch = false): AILevel {
  const style = character.style;
  const level: AILevel = {
    reaction: lerp(0.52, 0.16, style.reading),
    speedFactor: lerp(0.62, 1, style.speed),
    timingSigma: lerp(0.06, 0.26, style.errors),
    errorScale: lerp(1.7, 0.9, style.precision),
    mishit: lerp(0, 0.18, style.errors),
    smart: lerp(0.15, 0.9, style.reading),
    lobChance: style.lob * 0.45,
    dropChance: style.drop * 0.22,
    netRush: style.netLean,
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
        level.impatience = trait.errorPerHit;
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
