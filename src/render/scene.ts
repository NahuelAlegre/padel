import type { CharacterId, MannerismClip, TellCue, TellPose } from '../characters/types';
import type { Insets } from '../core/layout';
import type { SimEvent } from '../sim/match';
import type { ShotKind, TeamId } from '../sim/types';
import type { CameraName } from './view';

/**
 * Everything a renderer needs to draw one frame, already interpolated between
 * two simulation steps. This is the whole contract between the game and its
 * looks: a renderer never reads the simulation directly, so the final art can
 * replace the grey prototype without touching the rules or the physics.
 */
export interface Scene {
  /** Interpolated simulation time, in seconds. */
  time: number;
  ball: SceneBall;
  players: ScenePlayer[];
  /**
   * Where the ball lands next, when the aid is on. `first` is false once the
   * ball has already bounced: that next landing is the one that loses the point.
   */
  bounce: { x: number; y: number; eta: number; first: boolean } | null;
  /** Where and when the person meets the ball, when the aid is on. */
  contact: SceneContact | null;
  /** Where the person is aiming, on the rival's court. */
  aim: SceneAim | null;
  /** Advice on where to stand, when the aid is on. */
  guide: { x: number; y: number } | null;
  /** First visit: a ghost hand shows the gesture until the first good hit. */
  tutorial: SceneTutorial | null;
  /** Rally pace above the base: 0 at the start, up to 1 in a long rally. */
  heat: number;
  pointer: PointerFeedback;
  reduceMotion: boolean;
  /** Show numbers meant for tuning (timing error in milliseconds). */
  debug: boolean;
}

export interface SceneBall {
  x: number;
  y: number;
  z: number;
  /** False while the ball should not be drawn. */
  visible: boolean;
}

export interface ScenePlayer {
  id: number;
  team: TeamId;
  /** Controlled by the person holding the device. */
  isHuman: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Metres run so far: drives the run cycle. */
  stride: number;
  anim: 'idle' | 'swing' | 'whiff' | 'serve';
  /** Progress of the animation: below 0 the swing is armed, 0..1 it plays. */
  animPhase: number;
  /** World-x side of the body the racket works on during the animation. */
  animSide: 1 | -1;
  /** World-x side the racket rests on: the player's hand, seen from the camera. */
  restSide: 1 | -1;
  shot: ShotKind;
  /**
   * Where the ball is met, relative to the feet, in world metres. The reach
   * is generous on purpose, so the body has to stretch for it to look right.
   */
  reachX: number;
  reachY: number;
  reachZ: number;
  /** Who this is, for its looks. Null for a player with no character (the person, today). */
  character: CharacterId | null;
  /** The shot it has decided to play and is winding up for. Null while there is none. */
  tell: SceneTell | null;
  /** A tic it is in the middle of, between points. It never delays anything. */
  act: SceneAct | null;
}

/** What the windup of a player gives away, before it swings. */
export interface SceneTell {
  /** What is coming: through, over or short. */
  kind: TellCue;
  /** The variant of the windup this character shows for it, or null for the plain one. */
  pose: TellPose | null;
  /** Where the ball is meant to go, in metres across the court from where the player stands. */
  aimX: number;
  /** Seconds since it made up its mind. */
  t: number;
}

export interface SceneAct {
  clip: MannerismClip;
  /** Seconds into it, and how long it lasts. */
  t: number;
  duration: number;
}

export interface SceneContact {
  x: number;
  y: number;
  z: number;
  /** Seconds until the ideal moment: positive before, negative after. */
  eta: number;
  /** Half width of the perfect and good windows, in seconds. */
  perfect: number;
  good: number;
}

export interface SceneAim {
  /** Where the ball is meant to land. */
  x: number;
  y: number;
  /** The shot that would come out right now: its name is part of the mark. */
  kind: ShotKind;
  /** Played on the side of the racket hand. */
  forehand: boolean;
  /** 0..1: how close to the walls it is aimed, which widens the scatter. */
  risk: number;
  /** The thumb was released: the shot is armed and waits for the ball. */
  armed: boolean;
}

export interface SceneTutorial {
  scheme: 'two' | 'one';
  stickSide: 'left' | 'right';
  /** What to show: how to serve, or how to move and hit. */
  step: 'serve' | 'play';
}

/** What the pointers are doing, so the renderer can draw the thumbs. */
export interface PointerFeedback {
  /** The thumb that aims or flicks: from where it went down to where it is. */
  stroke: {
    active: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** performance.now() at release, 0 while the finger is down. */
    releasedAt: number;
  };
  stick: {
    active: boolean;
    cx: number;
    cy: number;
    dx: number;
    dy: number;
    radius: number;
  };
}

export function createPointerFeedback(): PointerFeedback {
  return {
    stroke: { active: false, x0: 0, y0: 0, x1: 0, y1: 0, releasedAt: 0 },
    stick: { active: false, cx: 0, cy: 0, dx: 0, dy: 0, radius: 0 },
  };
}

/**
 * What the game asks of whatever draws it. The game holds nothing but this
 * interface, so the grey prototype, the final art in Canvas 2D or a WebGL
 * renderer can be swapped without touching anything else.
 *
 * How a renderer builds its picture is its own business. The scenery only
 * depends on what `resize` and `setCamera` give it, so it can be painted or
 * baked once and copied every frame; if baking takes a while (compiling a
 * shader, say), the renderer starts with something quick and swaps it in when
 * it is ready: nobody waits for it, and none of these calls is asynchronous.
 */
export interface Renderer {
  /** The canvas changed size, pixel density or safe area. */
  resize(width: number, height: number, pixelRatio: number, safeArea: Insets): void;
  /** Which of the framings to use. */
  setCamera(name: CameraName): void;
  /**
   * Where a point of the court falls on screen, in CSS pixels. For what is
   * drawn outside the canvas but belongs to something on court (a speech
   * bubble over a player).
   */
  project(x: number, y: number, z: number, out: { x: number; y: number }): void;
  /** Something happened in the simulation: start an effect, a sound, an animation. */
  onEvent(event: SimEvent, scene: Scene): void;
  /** Draws one frame. `dt` is the real time since the previous frame, in seconds. */
  render(scene: Scene, dt: number): void;
  /** Drops every running effect (new match, restart). */
  reset(): void;
}
