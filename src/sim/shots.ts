import type { CourtConfig, PhysicsConfig, TimingConfig } from '../config';
import { netHeightAt } from './court';
import type { Quality } from './types';

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  /** Flight time until the ball lands on the target. */
  time: number;
}

export interface ShotParams {
  /** Minimum height above the net tape. */
  clearance: number;
  /** Peak height of the arc, 0 = as flat as `speed` allows. */
  apex: number;
  /** Top horizontal speed. */
  speed: number;
}

/** No shot hangs in the air longer than this, however much clearance it would need. */
const MAX_FLIGHT_TIME = 2.6;

/**
 * Launch velocity that takes the ball from (x0, y0, z0) to the floor at
 * (targetX, targetY).
 *
 * Without drag the flight is a parabola, so one number is left to choose: the
 * flight time. A lob fixes it through the height of the arc; every other shot
 * goes as fast as `speed` allows, and slows down (which also raises the arc)
 * just enough to clear the net by `clearance`.
 */
export function solveShot(
  x0: number,
  y0: number,
  z0: number,
  targetX: number,
  targetY: number,
  params: ShotParams,
  physics: PhysicsConfig,
  court: CourtConfig,
): Launch {
  const g = physics.gravity;
  const z1 = physics.ballRadius;
  const dx = targetX - x0;
  const dy = targetY - y0;
  const distance = Math.hypot(dx, dy);

  let time: number;
  if (params.apex > 0) {
    const apex = Math.max(params.apex, z0 + 0.3);
    const up = Math.sqrt(2 * g * (apex - z0));
    time = (up + Math.sqrt(up * up + 2 * g * (z0 - z1))) / g;
  } else {
    time = distance / Math.max(params.speed, 0.1);
  }

  // Height needed where the path crosses the net plane.
  if (y0 * targetY < 0 && dy !== 0) {
    const s = -y0 / dy;
    const crossX = x0 + dx * s;
    const needed = netHeightAt(court, crossX) + params.clearance + physics.ballRadius;
    const straight = z0 * (1 - s) + z1 * s;
    if (needed > straight) {
      // A ball dug out right next to the net would need an absurd arc to clear
      // it: cap the flight time and let it die in the net instead.
      const minTime = Math.min(MAX_FLIGHT_TIME, Math.sqrt((2 * (needed - straight)) / (g * s * (1 - s))));
      if (minTime > time) time = minTime;
    }
  }

  time = Math.max(time, 0.05);
  return {
    vx: dx / time,
    vy: dy / time,
    vz: (z1 - z0) / time + 0.5 * g * time,
    time,
  };
}

/**
 * Timing error in seconds (negative = the swing came before the ball) to the
 * quality shown to the player.
 */
export function qualityFromError(error: number, timing: TimingConfig): Quality {
  const magnitude = Math.abs(error);
  if (magnitude <= timing.perfect) return 'perfect';
  if (magnitude <= timing.good) return 'good';
  return error < 0 ? 'early' : 'late';
}
