/** Team 0 plays on the near half (y < 0), team 1 on the far half (y > 0). */
export type TeamId = 0 | 1;

export const otherTeam = (team: TeamId): TeamId => (team === 0 ? 1 : 0);

/**
 * Shots as they are called on a padel court. A player never picks one from a
 * list: it says where it wants the ball, and the situation (height of the
 * ball, position, wall or no wall) decides which shot that is.
 */
export type ShotKind =
  | 'serve'
  | 'drive' // groundstroke: derecha or revés
  | 'volley'
  | 'lob' // globo
  | 'drop' // chiquita after the bounce, dejada in the air
  | 'smash' // remate
  | 'bandeja'
  | 'vibora'
  | 'wallExit' // salida de pared
  | 'backWall'; // contrapared

/** How well the swing was timed against the arrival of the ball. */
export type Quality = 'perfect' | 'good' | 'early' | 'late';

/** Everything a player decides about a shot: where, how deep, how high, how hard. */
export interface ShotIntent {
  /** Lateral aim in world space: -1 is the left edge of the screen, +1 the right edge. */
  aim: number;
  /** How deep the ball should land: 0 just over the net, 1 at the back of the court. */
  depth: number;
  /** Over the opponent instead of through. */
  lob: boolean;
  /** Pace of the shot against its usual one: 1 is normal, a hard hitter goes a little over. */
  power: number;
  /** How careless this swing is: multiplies the scatter. Left out, it is 1. */
  scatter?: number;
  /**
   * Strain the player brings to this swing on top of what the rally has done
   * to it: somebody impatient, deep into a point. Left out, it is 0.
   */
  tension?: number;
}

export function createShotIntent(aim = 0, depth = 0.6, lob = false, power = 1): ShotIntent {
  return { aim, depth, lob, power };
}

/** What a controller wants its player to do during one simulation step. */
export interface PlayerIntent {
  /** When true the player runs to (targetX, targetY); otherwise it follows (moveX, moveY). */
  hasTarget: boolean;
  targetX: number;
  targetY: number;
  /** Direct movement in world space, each component in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** Set for exactly one step to request a swing. */
  swing: ShotIntent | null;
  /**
   * The shot the player has made up its mind to play, held from the moment it
   * decides until it swings. It changes nothing in the rally: it is what the
   * windup shows, so an opponent who watches can read what is coming.
   */
  cue: ShotIntent | null;
  /** Where to wait while the ball is on the other side. Null leaves it to the match. */
  home: 'back' | 'net' | null;
}

export function createIntent(): PlayerIntent {
  return { hasTarget: false, targetX: 0, targetY: 0, moveX: 0, moveY: 0, swing: null, cue: null, home: null };
}

export function resetIntent(intent: PlayerIntent): void {
  intent.hasTarget = false;
  intent.moveX = 0;
  intent.moveY = 0;
  intent.swing = null;
  intent.cue = null;
  intent.home = null;
}
