import { SIM_DT, type GameConfig } from '../config';
import { copyBall, createBall, stepBall, type BallEvent, type BallState } from './ball';
import { applyBallEvent, canHit, copyRally, createRally, type RallyResult, type RallyState } from './rules';

/** The ball at one future simulation step. */
export interface TrajPoint {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Team that may legally hit the ball at this moment, or -1. */
  hittable: number;
  /** Floor bounces so far (0 = it can only be volleyed). */
  bounces: number;
  /** Wall hits so far. */
  walls: number;
}

/** The future of the ball if nobody touches it again. */
export interface Trajectory {
  id: number;
  /** Simulation time of points[0]. Points are SIM_DT apart. */
  t0: number;
  points: TrajPoint[];
  /** First contact with the floor, for the bounce marker. */
  bounce: { t: number; x: number; y: number } | null;
  /** How the point (or the serve) ends untouched. Null if it outlives the horizon. */
  end: { t: number; result: RallyResult } | null;
}

let nextId = 1;

const scratchBall = createBall();
const scratchRally = createRally();
const scratchEvents: BallEvent[] = [];

/**
 * Simulates the ball forward with the same physics and rules as the match.
 * Used by the AI, by the assisted movement and by the visual aids.
 */
export function predictTrajectory(
  ball: BallState,
  rally: RallyState,
  t0: number,
  config: GameConfig,
  horizon = 6,
): Trajectory {
  const b = scratchBall;
  const r = scratchRally;
  copyBall(ball, b);
  copyRally(rally, r);

  const trajectory: Trajectory = { id: nextId++, t0, points: [], bounce: null, end: null };
  const steps = Math.ceil(horizon / SIM_DT);
  let bounces = 0;
  let walls = 0;
  let t = t0;

  const push = (): void => {
    const hittable = r.live ? (canHit(r, 0, b.y) ? 0 : canHit(r, 1, b.y) ? 1 : -1) : -1;
    trajectory.points.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, hittable, bounces, walls });
  };

  push();
  for (let i = 0; i < steps; i++) {
    scratchEvents.length = 0;
    stepBall(b, SIM_DT, config.physics, config.court, scratchEvents);
    t = t0 + (i + 1) * SIM_DT;
    for (const event of scratchEvents) {
      if (event.type === 'floor') {
        bounces++;
        if (!trajectory.bounce) trajectory.bounce = { t, x: event.x, y: event.y };
      } else if (event.type === 'wall') {
        walls++;
      }
      const result = applyBallEvent(r, event, config.court);
      if (result && !trajectory.end) {
        trajectory.end = { t, result };
        r.live = false;
      }
    }
    push();
    if (trajectory.end) break;
  }
  return trajectory;
}

/** The point of the trajectory closest to simulation time `t`, or null when out of range. */
export function pointAt(trajectory: Trajectory, t: number): TrajPoint | null {
  const index = Math.round((t - trajectory.t0) / SIM_DT);
  if (index < 0 || index >= trajectory.points.length) return null;
  return trajectory.points[index] ?? null;
}
