import { CONTROLS, type ControlsConfig } from '../config';
import { clamp } from '../core/math';
import type { ShotIntent } from '../sim/types';

/** Length a swipe needs to count as a lob, in CSS pixels. */
export function lobLength(viewportHeight: number, controls: ControlsConfig = CONTROLS): number {
  return clamp(viewportHeight * controls.lobLengthFraction, controls.lobLengthMin, controls.lobLengthMax);
}

/**
 * Turns a finished touch into a shot.
 *
 *   tap                   safe shot to the middle
 *   swipe                 drive, aimed where the swipe points
 *   long swipe upward     lob
 *   swipe downward        drop shot
 *
 * `dx` and `dy` are the movement from touch-down to release in CSS pixels,
 * with y growing downward as on screen. Returns null for a touch that should
 * do nothing (a long press).
 */
export function interpretGesture(
  dx: number,
  dy: number,
  durationMs: number,
  viewportHeight: number,
  controls: ControlsConfig = CONTROLS,
): ShotIntent | null {
  const distance = Math.hypot(dx, dy);
  if (distance < controls.swipeMinDistance) {
    return durationMs <= controls.tapMaxDuration ? { kind: 'safe', aim: 0 } : null;
  }

  // 0 = straight up, 90 = right, -90 = left, 180 = straight down.
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const tilt = Math.abs(angle);

  if (tilt >= controls.dropMinAngle) {
    const full = Math.sin((controls.aimMaxAngle * Math.PI) / 180);
    return { kind: 'drop', aim: clamp(dx / (distance * full), -1, 1) };
  }

  const aim = clamp(angle / controls.aimMaxAngle, -1, 1);
  if (distance >= lobLength(viewportHeight, controls) && tilt <= controls.lobMaxAngle) {
    return { kind: 'lob', aim };
  }
  return { kind: 'drive', aim };
}
