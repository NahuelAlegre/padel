import type { CharacterId, MannerismClip, TellCue, TellPose } from '../characters/types';
import type { Insets } from '../core/layout';
import type { SimEvent } from '../sim/match';
import type { ShotKind, TeamId } from '../sim/types';
import type { CameraName } from './view';

/**
 * Everything a renderer needs to draw one frame, already interpolated between
 * two simulation steps. This is the whole contract between the game and its
 * looks: a renderer never reads the simulation directly, so how the game
 * looks can change without touching the rules or the physics.
 */
/**
 * How much help is on screen. The default is very little: the game is for
 * somebody who wants something simple and does not want to read.
 */
export type AidLevel = 'full' | 'minimal' | 'none';

export interface Scene {
  /** Interpolated simulation time, in seconds. */
  time: number;
  ball: SceneBall;
  players: ScenePlayer[];
  /** Who is about to serve or serving, by position in `players`; -1 during a rally. */
  serving: number;
  /**
   * How much help was asked for, and with the minimal help how much of it is
   * left (0..1): it fades as the person gets it right. What exists at each
   * level is already decided below; this is for how to show it.
   */
  aids: AidLevel;
  aidStrength: number;
  /**
   * Where the ball lands next, when the aid is on. `first` is false once the
   * ball has already bounced: that next landing is the one that loses the point.
   */
  bounce: { x: number; y: number; eta: number; first: boolean } | null;
  /**
   * Where and when the person meets the ball. With the minimal help it is
   * shown as one signal in the last instant; with all of it, with its windows.
   */
  contact: SceneContact | null;
  /** Where the person is aiming, on the rival's court. With the minimal help, only while the thumb is down. */
  aim: SceneAim | null;
  /** Advice on where to stand, when the aid is on. */
  guide: { x: number; y: number } | null;
  /**
   * A ghost hand showing a gesture, with no words: the first visit, a lesson
   * of the tutorial, or a shot worth trying that the person has not found yet.
   */
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
  /** Metres per second. */
  vx: number;
  vy: number;
  vz: number;
  /** False while the ball should not be drawn. */
  visible: boolean;
  /** In the server's hand, before the serve. */
  held: boolean;
  /** In play: from the serve until the point is over. A dead ball is still drawn, but nobody follows it. */
  live: boolean;
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
  /**
   * Seconds until the racket of the stroke meets the ball: positive before,
   * negative after. Infinity with no stroke, and while the player is armed
   * with no ball within reach yet.
   */
  contactIn: number;
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
  /** What to show: how to serve, how to move and hit, or only the thumb that aims. */
  step: 'serve' | 'play' | 'aim';
  /**
   * Where the aiming thumb goes from where it went down, in CSS pixels of the
   * screen (x to the right, y down). Null for the plain gesture. It is what
   * tells a lob (far up) from a chiquita (down) without a word.
   */
  drag: { x: number; y: number } | null;
  /** Where the thumb on the stick pushes, each -1..1 on the screen. Null when it is up to the person. */
  push: { x: number; y: number } | null;
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
 * interface: whether a frame comes out in 3D with WebGL2 or in plain Canvas
 * 2D is the renderer's own business.
 *
 * None of these calls is asynchronous. A renderer that needs files or a
 * graphics context gets them on its own and draws with what it has in the
 * meantime: nobody waits for it.
 */
export interface Renderer {
  /** Which look is on screen right now: the 3D one or the plain one it falls back to. */
  readonly look: '3d' | '2d';
  /**
   * Called when what the renderer can draw changed and nobody asked it for a
   * frame: its files arrived, the graphics context went away or came back.
   * Whoever is showing a still picture (a menu, a pause) draws it again.
   */
  onChange: (() => void) | null;
  /** The canvas changed size, pixel density or safe area. */
  resize(width: number, height: number, pixelRatio: number, safeArea: Insets): void;
  /** Which camera to watch the game with. A renderer that cannot move its camera keeps it still. */
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
