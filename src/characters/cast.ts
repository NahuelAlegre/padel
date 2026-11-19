import type { Character, CharacterId } from './types';

/**
 * The first three rivals, in order of difficulty. Each one is a piece of
 * padel to learn, and is beaten by playing it:
 *
 *   Beto    hitting the ball, aiming, the first trip to the net
 *   Romina  patience: not feeding her, and making the point last
 *   Chela   winning the net and holding it
 *
 * The stars give the edge (see `toAILevel`); the style below gives the shape,
 * and says where each one is better or worse than its stars: 0.5 is "what the
 * stars give". Nobody misses for no reason and nobody outruns a person, so a
 * rival is easy or hard because of how it plays:
 *
 *   - Beto is the first one because he does not finish the ball that is there
 *     to be attacked, hardly ever goes to the net and feeds comfortable balls.
 *   - Romina's mistakes are in her habits: her impatience adds to her strain
 *     when a point goes on, and the glass costs her.
 *   - Chela gets everything back from the back, lobs whoever is at the net
 *     and hardly ever loses her head. She is slow, and her lob comes out
 *     short when she is made to dig the ball out.
 *
 * The numbers were tuned with `npm run sim` (the depth report). They are
 * still starting points: nobody has measured real people against them.
 */
export const CAST: Record<CharacterId, Character> = {
  // The coach: comfortable balls to the middle and toward you. The empty side and the net beat him.
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
      composure: 0.5,
    },
    // The coach plays his side and the middle by the book, covers you and calls everything.
    attitude: 'balanced',
    traits: [{ kind: 'feeder', chance: 0.4, firstMatchChance: 0.7 }],
    // He points with his free hand at where he is going to play, as in class.
    tell: { lead: 0.55, cues: { drive: 'pointAim', lob: 'pointAim', drop: 'pointAim' } },
    mannerisms: [
      { clip: 'cap', duration: 0.5, weight: 2 },
      { clip: 'whistle', duration: 0.6, weight: 1 },
    ],
    talk: 0.45,
  },

  // Hits flat and hard from anywhere, punishes a floating ball and wants every point over now. Patience beats her.
  romina: {
    id: 'romina',
    name: 'Romina',
    nickname: 'la Topadora',
    stars: 2,
    hand: 1,
    style: {
      aggression: 0.9,
      netLean: 0.7,
      wallUse: 0.2,
      lob: 0.1,
      drop: 0.1,
      power: 1,
      precision: 0.5,
      errors: 0.35,
      speed: 0.55,
      reading: 0.5,
      angle: 0.4,
      composure: 0.3,
    },
    // Up to the net, everything over her head is hers, and "¡mía!" more often than you would like.
    attitude: 'aggressive',
    traits: [
      { kind: 'impatient', afterHits: 4, strainPerHit: 0.15 },
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

  // Lobs and chiquitas from the back, and almost no mistakes. Taking the net and holding it beats her.
  chela: {
    id: 'chela',
    name: 'Chela',
    nickname: 'la Astronauta',
    stars: 3,
    hand: 1,
    style: {
      aggression: 0.2,
      netLean: 0.05,
      wallUse: 0.9,
      lob: 1,
      drop: 0.35,
      power: 0.1,
      precision: 0.6,
      errors: 0.38,
      speed: 0.1,
      reading: 0.6,
      angle: 0.4,
      composure: 0.8,
    },
    // From the back she gets everything back and leaves you the doubtful ones and the net.
    attitude: 'passive',
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
