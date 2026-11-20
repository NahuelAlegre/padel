import type { ScenePlayer } from '../scene';
import type { StageView } from './view';

/**
 * One frame, worked out: everything both ways of drawing the game need to
 * know, already decided. The 3D renderer and the plain 2D one draw the same
 * frame; they only differ in how good it looks.
 */
export interface StageFrame {
  view: StageView;
  /** How far the sky slides when the camera turns, in design pixels. */
  skyShift: number;
  /**
   * The near glass and what stands in front of it. The cameras of the
   * animation studio are behind it, close on a player or to its side: there
   * it would only get in the way.
   */
  nearWall: boolean;
  figures: FigureFrame[];
  ball: BallFrame;
  /** Where the ball is going to bounce, when that is shown. */
  bounce: MarkFrame | null;
  /** Where the person is aiming, when that is shown. */
  aim: MarkFrame | null;
  /** Where it would be best to stand, when that is shown. */
  guide: { x: number; y: number; alpha: number } | null;
  /** The ring that says which player is the person's, when that is shown. */
  ring: { x: number; y: number; k: number } | null;
  /** The old timing ring, for those who ask for every aid. */
  timing: { x: number; y: number; z: number; eta: number; perfect: number; good: number } | null;
  effects: EffectFrame[];
}

export interface FigureFrame {
  /** What the simulation says about this player. */
  player: ScenePlayer;
  /** Where it is drawn. It can be a step away from where it stands, while it lunges for a ball. */
  x: number;
  y: number;
  /** How much bigger than life it is drawn. */
  k: number;
  /** Which way it looks along the court: +1 toward the far end, -1 toward the camera. */
  facing: 1 | -1;
  /** Distance from the camera, for the width of its outline. */
  depth: number;
  /** Its colours: one for every material of the character. */
  palette: Float32Array;
  /** What of the mesh is this character: [first index, how many]. Null draws the plain body. */
  parts: ReadonlyArray<readonly [number, number]> | null;
  /** The matrix of every bone, when there is a skeleton to pose. */
  bones: Float32Array | null;
}

export interface BallFrame {
  x: number;
  y: number;
  z: number;
  visible: boolean;
  /**
   * The figure it is drawn over whatever their depths: the one it is on the
   * racket of, right as it is hit. Null otherwise.
   */
  over: FigureFrame | null;
  /** 0..1: lit up in the last instant before the person has to hit it. */
  glow: number;
  /** Where it was in the last few frames, newest first: x, y, z each. */
  trail: Float32Array;
  trailCount: number;
}

export interface MarkFrame {
  x: number;
  y: number;
  /** Metres. */
  radius: number;
  alpha: number;
  /** 0..1 from when it appears until the ball gets there. */
  progress: number;
  /** The coral one is where the person aims; the cream one, where the ball comes down. */
  tone: 'cream' | 'coral';
  /** A lob comes down from above: a second ring. For those who ask for every aid. */
  double: boolean;
  /** Room the ball may scatter in, as a halo. For those who ask for every aid. */
  halo: number;
}

export interface EffectFrame {
  kind: 'hit' | 'bounce' | 'glass';
  x: number;
  y: number;
  z: number;
  /** 0..1 through its short life. */
  age: number;
  /** A perfect hit or a smash shines a little more. */
  strong: boolean;
}

/**
 * Whether the ball is drawn before a figure, so that the figure hides it.
 * Only when it is really behind: somebody with their back to the camera
 * meets the ball in front of their body, which from the camera is behind it,
 * and the ball a player is about to hit has to be seen.
 */
export function ballBehind(ball: BallFrame, figure: FigureFrame): boolean {
  return ball.over !== figure && ball.y > figure.y + (figure.facing > 0 ? BALL_IN_FRONT * figure.k : 0);
}

/** How far beyond a player with its back to the camera the ball is still drawn over it, in metres at life size. */
const BALL_IN_FRONT = 0.9;

/** How long each effect lasts, in seconds: short, so they do not dirty the screen. */
export const EFFECT_SECONDS = { hit: 0.16, bounce: 0.2, glass: 0.22 };
