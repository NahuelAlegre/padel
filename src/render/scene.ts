import type { SimEvent } from '../sim/match';
import type { ShotKind, TeamId } from '../sim/types';

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

/** What the pointer is doing, so the renderer can draw the swipe and the stick. */
export interface PointerFeedback {
  swipe: {
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
    swipe: { active: false, x0: 0, y0: 0, x1: 0, y1: 0, releasedAt: 0 },
    stick: { active: false, cx: 0, cy: 0, dx: 0, dy: 0, radius: 0 },
  };
}

export interface Renderer {
  /** The canvas changed size or pixel density. */
  resize(width: number, height: number, pixelRatio: number): void;
  /** Something happened in the simulation: start an effect, a sound, an animation. */
  onEvent(event: SimEvent, scene: Scene): void;
  /** Draws one frame. `dt` is the real time since the previous frame, in seconds. */
  render(scene: Scene, dt: number): void;
  /** Drops every running effect (new match, restart). */
  reset(): void;
}
