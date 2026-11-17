import type { CourtConfig, PhysicsConfig } from '../config';
import { netHeightAt, sideWallAt } from './court';
import type { TeamId } from './types';

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** On the floor and no longer bouncing. */
  rolling: boolean;
  /** Flew over a wall: it is out of the court and nothing stops it any more. */
  outside: boolean;
}

export type WallId = 'backNear' | 'backFar' | 'left' | 'right';
export type Surface = 'glass' | 'fence';

/** Everything the ball can run into during one step. The rules are built on these. */
export type BallEvent =
  | { type: 'floor'; x: number; y: number; speed: number; rolling: boolean }
  | { type: 'wall'; wall: WallId; surface: Surface; x: number; y: number; z: number; speed: number }
  | { type: 'net'; x: number; z: number; cord: boolean }
  | { type: 'cross'; x: number; z: number; toSide: TeamId }
  | { type: 'out'; wall: WallId; x: number; y: number; z: number };

export function createBall(): BallState {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rolling: false, outside: false };
}

export function copyBall(from: BallState, to: BallState): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.rolling = from.rolling;
  to.outside = from.outside;
}

/**
 * Advances the ball by `dt` and appends whatever it hit to `events`.
 *
 * The function is deterministic and only depends on its arguments: the live
 * match and the trajectory prediction (AI, bounce marker) run the very same
 * code, so a prediction is exact until somebody hits the ball.
 */
export function stepBall(
  ball: BallState,
  dt: number,
  physics: PhysicsConfig,
  court: CourtConfig,
  events: BallEvent[],
): void {
  const radius = physics.ballRadius;
  const prevX = ball.x;
  const prevY = ball.y;
  const prevZ = ball.z;

  if (ball.rolling) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const drop = physics.rollDecel * dt;
    if (speed <= drop) {
      ball.vx = 0;
      ball.vy = 0;
    } else {
      const keep = (speed - drop) / speed;
      ball.vx *= keep;
      ball.vy *= keep;
    }
    ball.vz = 0;
    ball.z = radius;
  } else {
    ball.vz -= physics.gravity * dt;
    ball.z += ball.vz * dt;
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (!ball.outside) {
    collideNet(ball, prevX, prevY, prevZ, physics, court, events);
  }

  if (!ball.rolling && ball.z <= radius && ball.vz < 0) {
    const impact = -ball.vz;
    ball.z = radius;
    ball.vx *= physics.floorGrip;
    ball.vy *= physics.floorGrip;
    if (impact < physics.rollSpeed) {
      ball.vz = 0;
      ball.rolling = true;
    } else {
      ball.vz = impact * physics.floorRestitution;
    }
    events.push({ type: 'floor', x: ball.x, y: ball.y, speed: impact, rolling: ball.rolling });
  }

  if (!ball.outside) {
    collideWalls(ball, physics, court, events);
  }
}

function collideNet(
  ball: BallState,
  prevX: number,
  prevY: number,
  prevZ: number,
  physics: PhysicsConfig,
  court: CourtConfig,
  events: BallEvent[],
): void {
  const crossed = (prevY < 0 && ball.y >= 0) || (prevY > 0 && ball.y <= 0);
  if (!crossed) return;

  const s = prevY / (prevY - ball.y);
  const x = prevX + (ball.x - prevX) * s;
  const z = prevZ + (ball.z - prevZ) * s;
  const from = prevY < 0 ? -1 : 1;
  const toSide: TeamId = from < 0 ? 1 : 0;
  if (Math.abs(x) > court.halfWidth) return;

  const tape = netHeightAt(court, x);
  if (z >= tape + physics.cordBand) {
    events.push({ type: 'cross', x, z, toSide });
    return;
  }

  if (z >= tape - physics.cordBand) {
    // Net cord: the ball clips the tape, loses most of its speed and drops over.
    ball.x = x;
    ball.y = -from * 0.03;
    ball.z = tape + physics.cordBand;
    ball.vx *= 0.5;
    ball.vy *= 0.35;
    ball.vz = Math.abs(ball.vz) * 0.2 + 1;
    events.push({ type: 'net', x, z, cord: true });
    events.push({ type: 'cross', x, z, toSide });
    return;
  }

  // Caught by the net: it falls on the side it came from.
  ball.x = x;
  ball.y = from * 0.03;
  ball.z = Math.max(z, physics.ballRadius);
  ball.vy = -ball.vy * physics.netRestitution;
  ball.vx *= physics.netGrip;
  if (ball.vz > 0) ball.vz *= physics.netGrip;
  events.push({ type: 'net', x, z, cord: false });
}

function collideWalls(
  ball: BallState,
  physics: PhysicsConfig,
  court: CourtConfig,
  events: BallEvent[],
): void {
  const limitX = court.halfWidth - physics.ballRadius;
  const limitY = court.halfLength - physics.ballRadius;

  if ((ball.x > limitX && ball.vx > 0) || (ball.x < -limitX && ball.vx < 0)) {
    const sign = ball.x > 0 ? 1 : -1;
    const wall: WallId = sign > 0 ? 'right' : 'left';
    const segment = sideWallAt(court, ball.y);
    if (ball.z > segment.fence) {
      ball.outside = true;
      events.push({ type: 'out', wall, x: ball.x, y: ball.y, z: ball.z });
      return;
    }
    const surface: Surface = ball.z <= segment.glass ? 'glass' : 'fence';
    const speed = Math.abs(ball.vx);
    ball.x = sign * limitX;
    if (surface === 'glass') {
      ball.vx = -ball.vx * physics.glassRestitution;
      ball.vy *= physics.glassGrip;
    } else {
      ball.vx = -ball.vx * physics.fenceRestitution;
      ball.vy *= physics.fenceGrip;
      ball.vz *= physics.fenceGrip;
    }
    events.push({ type: 'wall', wall, surface, x: ball.x, y: ball.y, z: ball.z, speed });
  }

  if ((ball.y > limitY && ball.vy > 0) || (ball.y < -limitY && ball.vy < 0)) {
    const sign = ball.y > 0 ? 1 : -1;
    const wall: WallId = sign > 0 ? 'backFar' : 'backNear';
    if (ball.z > court.backFence) {
      ball.outside = true;
      events.push({ type: 'out', wall, x: ball.x, y: ball.y, z: ball.z });
      return;
    }
    const surface: Surface = ball.z <= court.backGlass ? 'glass' : 'fence';
    const speed = Math.abs(ball.vy);
    ball.y = sign * limitY;
    if (surface === 'glass') {
      ball.vy = -ball.vy * physics.glassRestitution;
      ball.vx *= physics.glassGrip;
    } else {
      ball.vy = -ball.vy * physics.fenceRestitution;
      ball.vx *= physics.fenceGrip;
      ball.vz *= physics.fenceGrip;
    }
    events.push({ type: 'wall', wall, surface, x: ball.x, y: ball.y, z: ball.z, speed });
  }
}
