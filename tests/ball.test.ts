import { describe, expect, it } from 'vitest';
import { SIM_DT, createConfig } from '../src/config';
import { createBall, stepBall, type BallEvent, type BallState } from '../src/sim/ball';
import { netHeightAt, sideWallAt } from '../src/sim/court';
import { createRally, registerHit } from '../src/sim/rules';
import { predictTrajectory } from '../src/sim/trajectory';

const config = createConfig();
const { physics, court } = config;

function ballAt(x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): BallState {
  return { ...createBall(), x, y, z, vx, vy, vz };
}

/** Steps the ball until an event of the given type shows up (or time runs out). */
function runUntil(ball: BallState, type: BallEvent['type'], maxSeconds = 5): { event: BallEvent; time: number } {
  const events: BallEvent[] = [];
  for (let i = 1; i <= maxSeconds / SIM_DT; i++) {
    events.length = 0;
    stepBall(ball, SIM_DT, physics, court, events);
    const found = events.find((event) => event.type === type);
    if (found) return { event: found, time: i * SIM_DT };
  }
  throw new Error(`No "${type}" event within ${maxSeconds} s`);
}

describe('gravedad y pique', () => {
  it('cae con la gravedad configurada', () => {
    const ball = ballAt(0, -5, 2);
    const { time } = runUntil(ball, 'floor');
    const expected = Math.sqrt((2 * (2 - physics.ballRadius)) / physics.gravity);
    expect(time).toBeCloseTo(expected, 1);
  });

  it('rebota con la restitución del piso', () => {
    const ball = ballAt(0, -5, 2);
    const { event } = runUntil(ball, 'floor');
    if (event.type !== 'floor') throw new Error('unreachable');
    expect(ball.vz).toBeCloseTo(event.speed * physics.floorRestitution, 5);

    // The next apex is the drop height times the restitution squared.
    let apex = 0;
    const events: BallEvent[] = [];
    for (let i = 0; i < 240 && events.length === 0; i++) {
      stepBall(ball, SIM_DT, physics, court, events);
      apex = Math.max(apex, ball.z);
    }
    const drop = 2 - physics.ballRadius;
    expect(apex - physics.ballRadius).toBeCloseTo(drop * physics.floorRestitution ** 2, 1);
  });

  it('pierde velocidad horizontal al picar', () => {
    const ball = ballAt(0, -5, 1, 3, 4, 0);
    runUntil(ball, 'floor');
    expect(ball.vx).toBeCloseTo(3 * physics.floorGrip, 5);
    expect(ball.vy).toBeCloseTo(4 * physics.floorGrip, 5);
  });

  it('una pelota lenta termina rodando y se detiene', () => {
    const ball = ballAt(0, -5, 0.3, 0.5, 0, 0);
    const events: BallEvent[] = [];
    for (let i = 0; i < 120 * 8; i++) stepBall(ball, SIM_DT, physics, court, events);
    expect(ball.rolling).toBe(true);
    expect(Math.hypot(ball.vx, ball.vy)).toBe(0);
    expect(ball.z).toBeCloseTo(physics.ballRadius, 6);
    // The floor event that starts the roll is flagged, so the rules can end the point.
    expect(events.some((event) => event.type === 'floor' && event.rolling)).toBe(true);
  });
});

describe('paredes', () => {
  it('el vidrio del fondo devuelve la pelota con su restitución', () => {
    const ball = ballAt(1, 9, 1, 0, 10, 2);
    const { event } = runUntil(ball, 'wall');
    expect(event).toMatchObject({ type: 'wall', wall: 'backFar', surface: 'glass' });
    expect(ball.vy).toBeCloseTo(-10 * physics.glassRestitution, 5);
    expect(ball.y).toBeLessThanOrEqual(court.halfLength);
  });

  it('la reja mata la pelota', () => {
    // Between 3 and 4 metres the back wall is fence.
    const ball = ballAt(0, 9.5, 3.5, 0, 10, 0);
    const { event } = runUntil(ball, 'wall');
    expect(event).toMatchObject({ type: 'wall', wall: 'backFar', surface: 'fence' });
    expect(ball.vy).toBeCloseTo(-10 * physics.fenceRestitution, 5);
    expect(physics.fenceRestitution).toBeLessThan(physics.glassRestitution);
  });

  it('por encima de la reja la pelota se va de la cancha', () => {
    const ball = ballAt(0, 9.5, 5, 0, 10, 2);
    const { event } = runUntil(ball, 'out');
    expect(event).toMatchObject({ type: 'out', wall: 'backFar' });
    expect(ball.outside).toBe(true);
  });

  it('el lateral cambia de vidrio a reja según la zona', () => {
    // First 2 m from the back: 3 m of glass. Next 2 m: 2 m of glass. Then fence only.
    expect(sideWallAt(court, 9)).toMatchObject({ glass: 3, fence: 4 });
    expect(sideWallAt(court, -7)).toMatchObject({ glass: 2, fence: 3 });
    expect(sideWallAt(court, 3)).toMatchObject({ glass: 0, fence: 3 });

    const corner = ballAt(4.5, 9, 2.5, 8, 0, 0);
    expect(runUntil(corner, 'wall').event).toMatchObject({ wall: 'right', surface: 'glass' });

    const step = ballAt(4.5, 7, 2.5, 8, 0, 1);
    expect(runUntil(step, 'wall').event).toMatchObject({ wall: 'right', surface: 'fence' });

    const middle = ballAt(-4.5, 3, 0.6, -8, 0, 1);
    const hit = runUntil(middle, 'wall');
    expect(hit.event).toMatchObject({ wall: 'left', surface: 'fence' });
    expect(middle.vx).toBeCloseTo(8 * physics.fenceRestitution, 5);
  });
});

describe('red', () => {
  it('es más baja en el centro que en los postes', () => {
    expect(netHeightAt(court, 0)).toBeCloseTo(0.88, 5);
    expect(netHeightAt(court, 5)).toBeCloseTo(0.92, 5);
    expect(netHeightAt(court, -2.5)).toBeCloseTo(0.9, 5);
  });

  it('frena una pelota que viene por debajo de la cinta', () => {
    const ball = ballAt(0, -1, 0.5, 0, 12, 0);
    const { event } = runUntil(ball, 'net');
    expect(event).toMatchObject({ type: 'net', cord: false });
    expect(ball.y).toBeLessThan(0);
    expect(ball.vy).toBeLessThanOrEqual(0);
  });

  it('deja pasar una pelota que viene por arriba', () => {
    const ball = ballAt(0, -1, 1.6, 0, 12, 1);
    const { event } = runUntil(ball, 'cross');
    expect(event).toMatchObject({ type: 'cross', toSide: 1 });
    expect(ball.y).toBeGreaterThan(0);
    expect(ball.vy).toBeCloseTo(12, 5);
  });

  it('una pelota que roza la cinta pasa muerta al otro lado', () => {
    const ball = ballAt(0, -0.05, netHeightAt(court, 0), 0, 12, 0);
    const events: BallEvent[] = [];
    stepBall(ball, SIM_DT, physics, court, events);
    expect(events.some((event) => event.type === 'net' && event.cord)).toBe(true);
    expect(events.some((event) => event.type === 'cross')).toBe(true);
    expect(ball.y).toBeGreaterThan(0);
    expect(ball.vy).toBeLessThan(12 * 0.5);
  });
});

describe('predicción', () => {
  it('coincide exactamente con la simulación real', () => {
    const ball = ballAt(2, -7, 0.9, -3.2, 15.5, 3.4);
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    const trajectory = predictTrajectory(ball, rally, 0, config);

    // The same ball, stepped for real, has to be where the prediction said.
    const events: BallEvent[] = [];
    const steps = Math.min(trajectory.points.length - 1, 300);
    for (let i = 1; i <= steps; i++) {
      stepBall(ball, SIM_DT, physics, court, events);
      const point = trajectory.points[i]!;
      expect(ball.x).toBe(point.x);
      expect(ball.y).toBe(point.y);
      expect(ball.z).toBe(point.z);
    }
    expect(trajectory.bounce).not.toBeNull();
    const firstFloor = events.find((event) => event.type === 'floor');
    expect(firstFloor).toMatchObject({ x: trajectory.bounce!.x, y: trajectory.bounce!.y });
  });

  it('sabe cómo termina el punto si nadie toca la pelota', () => {
    // A drive that lands deep and is never returned: second bounce, point for the hitter.
    const ball = ballAt(0, -7, 0.9, 0, 15.5, 3.4);
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    const trajectory = predictTrajectory(ball, rally, 0, config);
    expect(trajectory.end?.result).toEqual({ kind: 'point', winner: 0, reason: 'doubleBounce' });

    // The receiver may only hit it once it is on its half, and never after the point is over.
    const first = trajectory.points.find((point) => point.hittable === 1);
    expect(first).toBeDefined();
    expect(first!.y).toBeGreaterThan(0);
    expect(trajectory.points.every((point) => point.hittable !== 0)).toBe(true);
    expect(trajectory.points[trajectory.points.length - 1]!.hittable).toBe(-1);
  });
});
