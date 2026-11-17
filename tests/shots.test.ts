import { describe, expect, it } from 'vitest';
import { SIM_DT, createConfig } from '../src/config';
import { createBall, stepBall, type BallEvent } from '../src/sim/ball';
import { netHeightAt } from '../src/sim/court';
import { qualityFromError, solveShot, type ShotParams } from '../src/sim/shots';

const config = createConfig();
const { physics, court } = config;

/** Launches a ball with the solved velocity and reports what the flight looked like. */
function fly(x0: number, y0: number, z0: number, tx: number, ty: number, params: ShotParams) {
  const launch = solveShot(x0, y0, z0, tx, ty, params, physics, court);
  const ball = { ...createBall(), x: x0, y: y0, z: z0, vx: launch.vx, vy: launch.vy, vz: launch.vz };
  const events: BallEvent[] = [];
  let apex = z0;
  let netZ = NaN;
  for (let i = 0; i < 120 * 6; i++) {
    stepBall(ball, SIM_DT, physics, court, events);
    apex = Math.max(apex, ball.z);
    const cross = events.find((event) => event.type === 'cross');
    if (cross && cross.type === 'cross' && Number.isNaN(netZ)) netZ = cross.z;
    const floor = events.find((event) => event.type === 'floor');
    if (floor && floor.type === 'floor') {
      return { launch, landing: floor, apex, netZ, events, speed: Math.hypot(launch.vx, launch.vy) };
    }
    if (events.some((event) => event.type === 'wall' || event.type === 'out')) break;
  }
  throw new Error('The ball never reached the floor');
}

describe('trayectoria de los golpes', () => {
  const drive = config.shots.specs.drive;
  const lob = config.shots.specs.lob;

  it('la pelota pica donde se apuntó', () => {
    for (const [x0, y0, z0, tx, ty] of [
      [0, -7, 0.9, 0, 7.4],
      [3, -8, 0.6, -3.8, 7.4],
      [-4, -3, 1.3, 3, 6],
      [2, 8, 1.0, -2, -7], // far side hitting toward the near side
    ] as const) {
      const { landing } = fly(x0, y0, z0, tx, ty, drive);
      expect(landing.x).toBeCloseTo(tx, 0);
      expect(Math.abs(landing.y - ty)).toBeLessThan(0.25);
    }
  });

  it('pasa la red con el margen pedido', () => {
    const { netZ } = fly(0, -7, 0.9, 0, 7.4, drive);
    expect(netZ).toBeGreaterThanOrEqual(netHeightAt(court, 0) + drive.clearance - 0.05);
  });

  it('no supera la velocidad máxima del golpe', () => {
    const { speed } = fly(0, -7, 0.9, 0, 7.4, drive);
    expect(speed).toBeLessThanOrEqual(drive.speed + 0.01);
  });

  it('desde arriba y cerca de la red va tan rápido como el golpe permite', () => {
    const smash = config.shots.specs.smash;
    const { speed, landing } = fly(0, -2.5, 2.4, 1, smash.depth, smash);
    expect(speed).toBeCloseTo(smash.speed, 0);
    expect(landing.y).toBeCloseTo(smash.depth, 0);
  });

  it('el globo sube hasta la altura configurada y cae al fondo', () => {
    const { apex, landing, launch } = fly(1, -7, 0.8, -1, lob.depth, lob);
    expect(apex).toBeCloseTo(lob.apex, 0);
    expect(landing.y).toBeCloseTo(lob.depth, 0);
    expect(launch.time).toBeGreaterThan(1.5);
  });

  it('más margen sobre la red significa una pelota más lenta', () => {
    const flat = fly(0, -7, 0.9, 0, 7.4, { clearance: 0.4, apex: 0, speed: 30 });
    const high = fly(0, -7, 0.9, 0, 7.4, { clearance: 1.5, apex: 0, speed: 30 });
    expect(high.speed).toBeLessThan(flat.speed);
    expect(high.netZ).toBeGreaterThan(flat.netZ);
  });

  it('una pelota pegada a la red no sale disparada al cielo', () => {
    const launch = solveShot(0, -0.05, 0.4, 0, lob.depth, lob, physics, court);
    expect(Math.hypot(launch.vx, launch.vy, launch.vz)).toBeLessThan(25);
  });
});

describe('calidad del golpe', () => {
  const timing = config.timing;

  it('depende de qué tan lejos del momento ideal fue el golpe', () => {
    expect(qualityFromError(0, timing)).toBe('perfect');
    expect(qualityFromError(timing.perfect, timing)).toBe('perfect');
    expect(qualityFromError(-timing.perfect, timing)).toBe('perfect');
    expect(qualityFromError(timing.perfect + 0.01, timing)).toBe('good');
    expect(qualityFromError(-timing.good, timing)).toBe('good');
  });

  it('fuera de la ventana distingue temprano de tarde', () => {
    expect(qualityFromError(-timing.good - 0.01, timing)).toBe('early');
    expect(qualityFromError(timing.good + 0.01, timing)).toBe('late');
    expect(qualityFromError(-1, timing)).toBe('early');
  });
});
