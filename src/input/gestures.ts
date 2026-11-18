import { CONTROLS, type ControlsConfig } from '../config';
import { clamp, lerp } from '../core/math';
import type { ShotIntent } from '../sim/types';

/** Depth asked for by a chiquita: anything at or below `shots.dropAt` is one. */
const DROP_DEPTH = 0.1;
/** Shallowest ball that is still a normal shot and not a chiquita. */
const SHORT_DEPTH = 0.32;

/**
 * Two-thumb scheme. Where the aiming thumb is, measured from where it went
 * down, is where the ball goes:
 *
 *   sideways        the side of the court
 *   up              deeper; far enough up, a lob
 *   down            a chiquita, just over the net
 *   not moved       the middle, at a comfortable depth
 *
 * `dx` and `dy` are in CSS pixels with y growing downward, as on screen.
 */
export function aimFromDrag(dx: number, dy: number, controls: ControlsConfig = CONTROLS): ShotIntent {
  const up = -dy;
  const aim = clamp(dx / controls.aimRadius, -1, 1);
  if (up >= controls.lobAt) return { aim, depth: 1, lob: true, power: 1 };
  if (up <= -controls.dropAt) return { aim, depth: DROP_DEPTH, lob: false, power: 1 };
  const depth =
    up >= 0
      ? lerp(controls.restDepth, 1, clamp(up / controls.deepAt, 0, 1))
      : lerp(controls.restDepth, SHORT_DEPTH, -up / controls.dropAt);
  return { aim, depth, lob: false, power: 1 };
}

/**
 * One-hand scheme. A flick is a shot: its direction aims, its length says
 * how deep, a long one upward is a lob and one pointing down is a chiquita.
 */
export function intentFromFlick(dx: number, dy: number, controls: ControlsConfig = CONTROLS): ShotIntent {
  const length = Math.hypot(dx, dy);
  // 0 = straight up, 90 = right, -90 = left, 180 = straight down.
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const tilt = Math.abs(angle);

  if (tilt >= controls.flickDropAngle) {
    const full = Math.sin((controls.flickAimAngle * Math.PI) / 180);
    return { aim: clamp(dx / (Math.max(length, 1) * full), -1, 1), depth: DROP_DEPTH, lob: false, power: 1 };
  }
  const aim = clamp(angle / controls.flickAimAngle, -1, 1);
  if (length >= controls.flickLobLength && tilt <= controls.flickAimAngle + 5) {
    return { aim, depth: 1, lob: true, power: 1 };
  }
  const t = clamp(
    (length - controls.flickShortLength) / (controls.flickDeepLength - controls.flickShortLength),
    0,
    1,
  );
  return { aim, depth: lerp(SHORT_DEPTH + 0.08, 1, t), lob: false, power: 1 };
}

/** A tap, or a key with no direction: the middle of the court at a comfortable depth. */
export function neutralIntent(controls: ControlsConfig = CONTROLS): ShotIntent {
  return { aim: 0, depth: controls.restDepth, lob: false, power: 1 };
}

export interface TouchSummary {
  /** Milliseconds between touch down and release. */
  duration: number;
  /** Distance between where it went down and where it lifted, in CSS pixels. */
  distance: number;
  /** The touch had already become the stick. */
  moving: boolean;
  /** Distance covered during the last `flingWindow` milliseconds, and how long that really was. */
  flingDistance: number;
  flingMs: number;
}

/**
 * One-hand scheme: what a finished touch was.
 *
 *   'flick'  a quick stroke from touch down: a shot along the whole movement
 *   'fling'  the thumb left the stick at speed: a shot along the last stretch
 *   'tap'    a touch that did not move: a shot to the middle
 *   'none'   the end of a drag: the player just stops
 *
 * Speed is what separates moving from hitting.
 */
export function classifyTouch(
  touch: TouchSummary,
  controls: ControlsConfig = CONTROLS,
): 'flick' | 'fling' | 'tap' | 'none' {
  if (!touch.moving) {
    if (touch.distance >= controls.flickMinDistance) return 'flick';
    return touch.distance <= controls.tapMaxDistance ? 'tap' : 'none';
  }
  const speed = touch.flingMs > 0 ? touch.flingDistance / touch.flingMs : 0;
  if (touch.flingDistance >= controls.flingMinDistance && speed >= controls.flingSpeed) return 'fling';
  return 'none';
}
