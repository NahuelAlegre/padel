import type { Character, CharacterId } from './types';

/**
 * The first three rivals, in order of difficulty. Three tempos (comfortable,
 * fast, slow) and three problems to solve (hit the ball, defend, attack).
 *
 * The shape of each style is the one of the cast design. Its edge (precision,
 * errors, speed, reading) was calibrated with `npm run sim` so the stars mean
 * what they say in this engine, and it is not the table of the design:
 *
 *   - Somebody who plays safe never misses here, so what makes Beto the first
 *     rival is that he mishits and is slow, not that he hits badly.
 *   - Romina's mistakes are in her habits (she gets wild in a long rally and
 *     off the glass) and in the risk of hitting everything hard, not in her
 *     base numbers. With those as high as designed anybody would beat her.
 *
 * They are still starting points: nobody has measured real people against them.
 */
export const CAST: Record<CharacterId, Character> = {
  // The coach: comfortable balls to the middle and toward you. Angles beat him.
  beto: {
    id: 'beto',
    name: 'Beto',
    nickname: 'el Profe',
    stars: 1,
    hand: 1,
    style: {
      aggression: 0.2,
      netLean: 0.3,
      wallUse: 0.5,
      lob: 0.25,
      drop: 0.15,
      power: 0.3,
      precision: 0.55,
      errors: 0.7,
      speed: 0.1,
      reading: 0.25,
      angle: 0.1,
    },
    traits: [{ kind: 'feeder', chance: 0.4, firstMatchChance: 0.7 }],
    // He points with his free hand at where he is going to play, as in class.
    tell: { lead: 0.55, cues: { drive: 'pointAim', lob: 'pointAim', drop: 'pointAim' } },
    mannerisms: [
      { clip: 'cap', duration: 0.5, weight: 2 },
      { clip: 'whistle', duration: 0.6, weight: 1 },
    ],
    talk: 0.45,
  },

  // Hits flat and hard from anywhere and wants every point over now. Patience beats her.
  romina: {
    id: 'romina',
    name: 'Romina',
    nickname: 'la Topadora',
    stars: 2,
    hand: 1,
    style: {
      aggression: 0.9,
      netLean: 0.6,
      wallUse: 0.2,
      lob: 0.1,
      drop: 0.1,
      power: 1,
      precision: 0.72,
      errors: 0.18,
      speed: 0.72,
      reading: 0.68,
      angle: 0.4,
    },
    traits: [
      { kind: 'impatient', afterHits: 4, errorPerHit: 0.08 },
      { kind: 'wallWeak', precisionFactor: 0.5 },
    ],
    // She plants her feet and takes the racket behind her head: a cannonball is coming.
    tell: { lead: 0.45, cues: { drive: 'plantWide' } },
    mannerisms: [
      { clip: 'sleeves', duration: 0.6, weight: 2 },
      { clip: 'shoeTap', duration: 0.56, weight: 2 },
      { clip: 'neck', duration: 0.7, weight: 1, when: 'afterLoss' },
    ],
    talk: 0.45,
  },

  // Lob after lob, sky high and deep, and almost no mistakes. Attacking beats her.
  chela: {
    id: 'chela',
    name: 'Chela',
    nickname: 'la Astronauta',
    stars: 3,
    hand: 1,
    style: {
      aggression: 0.2,
      netLean: 0.15,
      wallUse: 0.9,
      lob: 1,
      drop: 0.4,
      power: 0.1,
      precision: 0.9,
      errors: 0.15,
      speed: 0.15,
      reading: 0.8,
      angle: 0.4,
    },
    traits: [{ kind: 'lobUnderPressure' }],
    // She crouches and opens the racket face, "like serving soup": a lob. A step in: a chiquita.
    tell: { lead: 0.5, cues: { lob: 'crouchOpenFace', drop: 'stepIn' } },
    mannerisms: [
      { clip: 'glasses', duration: 0.45, weight: 2 },
      { clip: 'wave', duration: 0.65, weight: 2 },
      { clip: 'kissRacket', duration: 0.5, weight: 1, when: 'afterWin' },
    ],
    talk: 0.4,
  },
};

/** Easiest first. */
export const CHARACTER_IDS: readonly CharacterId[] = ['beto', 'romina', 'chela'];

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}
