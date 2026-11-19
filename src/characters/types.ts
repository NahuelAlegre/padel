import type { Attitude } from '../sim/pair';

/**
 * The people of the club: rivals today, partners when doubles arrive.
 *
 * A character is data. How it plays goes into the simulation as numbers (see
 * `style.ts`); everything else here is presentation and never changes a rally.
 * The cast is designed in docs/personajes.md; the prototype has its first three.
 */
export type CharacterId = 'beto' | 'romina' | 'chela';

/**
 * How somebody plays. Every value is 0..1.
 *
 * The first ones are tastes: what it likes to do. The last five are where it
 * is better or worse than its stars say: 0.5 is "what its stars give", and
 * each end is worth two stars (see `toAILevel`).
 */
export interface PlayStyle {
  /** Hard, deep shots over safe ones to the middle, and finishing the ball that is there to be attacked. */
  aggression: number;
  /** 0 lives at the back, 1 follows every attacking shot to the net and holds it. */
  netLean: number;
  /** How much it likes to let the ball come off the glass before playing it. */
  wallUse: number;
  lob: number;
  /** Chiquita and dejada. */
  drop: number;
  /** Pace of its shots. */
  power: number;
  /** Less scatter. */
  precision: number;
  /** Unforced errors: mistimed swings. */
  errors: number;
  speed: number;
  /** Reaction, and how often it picks the right target. */
  reading: number;
  /** 0 plays through the middle, 1 hunts the side walls. */
  angle: number;
  /** How little a run of difficult balls gets to it. */
  composure: number;
}

/** A behaviour that makes a character memorable. Each one is a small hook in the AI. */
export type Trait =
  /** Plays the ball to the opponent instead of away, the way a coach feeds balls. */
  | { kind: 'feeder'; chance: number; firstMatchChance: number }
  /** From `afterHits` hits into a rally, every further hit adds to its strain: it comes apart when it is made to wait. */
  | { kind: 'impatient'; afterHits: number; strainPerHit: number }
  /** Loses its aim when it has to play off the glass. */
  | { kind: 'wallWeak'; precisionFactor: number }
  /** Reached late, it always lobs. */
  | { kind: 'lobUnderPressure' };

/** What a windup can announce: the three things a player can ask of a shot. */
export type TellCue = 'drive' | 'lob' | 'drop';

/** A variant of the windup, readable at the size a rival is drawn. */
export type TellPose =
  /** The free hand points where the ball will go. */
  | 'pointAim'
  /** Legs wide apart, racket behind the head. */
  | 'plantWide'
  /** Knees bent and the racket face open, low. */
  | 'crouchOpenFace'
  /** A small step toward the net, standing tall. */
  | 'stepIn';

/** The gesture that gives a shot away. It never lies. */
export interface Tell {
  /** Seconds before contact at which the shot is decided and can be read. Shorter is harder. */
  lead: number;
  /** Which shot shows which pose. A shot with no entry gets the plain windup. */
  cues: Partial<Record<TellCue, TellPose>>;
}

/** A short tic between points. It overlays the upper body, so the legs keep walking. */
export type MannerismClip =
  | 'cap'
  | 'whistle'
  | 'sleeves'
  | 'shoeTap'
  | 'neck'
  | 'glasses'
  | 'wave'
  | 'kissRacket';

export interface Mannerism {
  clip: MannerismClip;
  /** Seconds, 0.9 at most. */
  duration: number;
  weight: number;
  when?: 'any' | 'afterWin' | 'afterLoss';
}

/** What a point was like, to choose a line that fits it. */
export type PointTag = 'wall' | 'lob' | 'smash' | 'drop' | 'error' | 'longRally';

/** A line anybody can say at any time, or one that only fits some points. */
export type Line = string | { text: string; when: PointTag[] };

export interface Lines {
  winPoint: Line[];
  losePoint: Line[];
  goldenPoint: Line[];
  /** Next to the rematch button, after the character won and after it lost. */
  rematchTheyWon: Line[];
  rematchTheyLost: Line[];
  /** At the start of a match: the first ever, another one, and one after a long time. */
  meetFirst: Line[];
  meetAgain: Line[];
  meetLongTime: Line[];
  /** Its tell, in its own words: said once to somebody it keeps beating. */
  hint: Line[];
}

export interface Character {
  id: CharacterId;
  name: string;
  nickname: string;
  /** Difficulty, in plain sight. */
  stars: 1 | 2 | 3 | 4 | 5;
  hand: 1 | -1;
  style: PlayStyle;
  /**
   * Doubles: how it shares the court when nobody asks it for anything else.
   * The person can ask its partner for another one (see `withAttitude`).
   */
  attitude: Attitude;
  traits: Trait[];
  tell: Tell;
  mannerisms: Mannerism[];
  /** 0..1: how often it has something to say after a point. */
  talk: number;
}

/** What is written about a character and what it says. Kept apart so it can be translated. */
export interface CharacterText {
  /** How it plays, in one line, for whoever is choosing a rival. */
  style: string;
  lines: Lines;
}
