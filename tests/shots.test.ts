import { describe, expect, it } from 'vitest';
import { SIM_DT, createConfig } from '../src/config';
import { createBall, stepBall, type BallEvent } from '../src/sim/ball';
import { netHeightAt } from '../src/sim/court';
import { createRally, registerHit, applyBallEvent } from '../src/sim/rules';
import {
  qualityFromError,
  resolveShot,
  solveBackWall,
  solveShot,
  type Launch,
  type ShotContext,
  type ShotParams,
} from '../src/sim/shots';
import type { ShotIntent } from '../src/sim/types';

const config = createConfig();
const { physics, court } = config;

/** Lets a launched ball fly and reports what the flight looked like. */
function follow(x0: number, y0: number, z0: number, launch: Launch) {
  const ball = { ...createBall(), x: x0, y: y0, z: z0, vx: launch.vx, vy: launch.vy, vz: launch.vz };
  const events: BallEvent[] = [];
  let apex = z0;
  let netZ = NaN;
  for (let i = 0; i < 120 * 6; i++) {
    const before = events.length;
    stepBall(ball, SIM_DT, physics, court, events);
    apex = Math.max(apex, ball.z);
    for (let e = before; e < events.length; e++) {
      const event = events[e]!;
      if (event.type === 'cross' && Number.isNaN(netZ)) netZ = event.z;
      if (event.type === 'floor') return { launch, landing: event, apex, netZ, events, speed: Math.hypot(launch.vx, launch.vy) };
      if (event.type === 'out') throw new Error('The ball left the court');
    }
  }
  throw new Error('The ball never reached the floor');
}

function fly(x0: number, y0: number, z0: number, tx: number, ty: number, params: ShotParams) {
  return follow(x0, y0, z0, solveShot(x0, y0, z0, tx, ty, params, physics, court));
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
    const { speed, landing } = fly(0, -2.5, 2.4, 1, smash.depthNear, smash);
    expect(speed).toBeCloseTo(smash.speed, 0);
    expect(landing.y).toBeCloseTo(smash.depthNear, 0);
  });

  it('el globo sube hasta la altura configurada y cae al fondo', () => {
    const { apex, landing, launch } = fly(1, -7, 0.8, -1, lob.depthNear, lob);
    expect(apex).toBeCloseTo(lob.apex, 0);
    expect(landing.y).toBeCloseTo(lob.depthNear, 0);
    expect(launch.time).toBeGreaterThan(1.5);
  });

  it('más margen sobre la red significa una pelota más lenta', () => {
    const flat = fly(0, -7, 0.9, 0, 7.4, { clearance: 0.4, apex: 0, speed: 30 });
    const high = fly(0, -7, 0.9, 0, 7.4, { clearance: 1.5, apex: 0, speed: 30 });
    expect(high.speed).toBeLessThan(flat.speed);
    expect(high.netZ).toBeGreaterThan(flat.netZ);
  });

  it('una pelota pegada a la red no sale disparada al cielo', () => {
    const launch = solveShot(0, -0.05, 0.4, 0, lob.depthNear, lob, physics, court);
    expect(Math.hypot(launch.vx, launch.vy, launch.vz)).toBeLessThan(25);
  });
});

describe('contrapared', () => {
  const spec = config.shots.specs.backWall;

  it('va al vidrio propio, vuelve por encima de la red y pica donde se apuntó', () => {
    // The ball got past a player of the near team, a metre from its back wall.
    const launch = solveBackWall(1, -9, 0.7, -2, 6.5, 0, spec, physics, court);
    expect(launch.vy).toBeLessThan(0); // sent backwards, into the glass

    const flight = follow(1, -9, 0.7, launch);
    const wall = flight.events.find((event) => event.type === 'wall');
    expect(wall).toMatchObject({ wall: 'backNear', surface: 'glass' });
    expect(flight.netZ).toBeGreaterThan(netHeightAt(court, 0) + 0.3);
    expect(flight.landing.y).toBeGreaterThan(0);
    expect(flight.landing.x).toBeCloseTo(-2, 0);
    expect(Math.abs(flight.landing.y - 6.5)).toBeLessThan(0.4);
  });

  it('es un golpe legal: el vidrio propio se puede usar', () => {
    const launch = solveBackWall(0, -9.2, 0.6, 0, 6.5, 0, spec, physics, court);
    const flight = follow(0, -9.2, 0.6, launch);
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    // Own glass, over the net, bounce on the other half: nothing ends the point.
    for (const event of flight.events) expect(applyBallEvent(rally, event, court)).toBeNull();
    expect(rally.bounces).toBe(1);
  });

  it('funciona igual para el equipo del otro lado', () => {
    const launch = solveBackWall(-1, 9.1, 0.8, 2, -6.5, 1, spec, physics, court);
    expect(launch.vy).toBeGreaterThan(0);
    const flight = follow(-1, 9.1, 0.8, launch);
    expect(flight.landing.y).toBeLessThan(0);
    expect(Math.abs(flight.landing.y + 6.5)).toBeLessThan(0.4);
  });
});

describe('el contexto decide el golpe', () => {
  /** A right-handed player of the near team, with the ball half a metre to its right. */
  const at = (y: number, z: number, more: Partial<ShotContext> = {}): ShotContext => ({
    team: 0,
    hand: 1,
    playerX: 0,
    playerY: y - 0.2,
    ballX: 0.6,
    ballY: y,
    ballZ: z,
    bounces: 1,
    walls: 0,
    ...more,
  });
  const ask = (more: Partial<ShotIntent> = {}): ShotIntent => ({ aim: 0, depth: 0.8, lob: false, power: 1, ...more });
  const kind = (ctx: ShotContext, intent = ask()) => resolveShot(ctx, intent, config).kind;

  it('una pelota normal después del pique es un golpe de fondo', () => {
    expect(kind(at(-7, 0.9))).toBe('drive');
  });

  it('es derecha o revés según el lado de la pelota y la mano', () => {
    expect(resolveShot(at(-7, 0.9), ask(), config).forehand).toBe(true);
    expect(resolveShot(at(-7, 0.9, { ballX: -0.6 }), ask(), config).forehand).toBe(false);
    // Left handed: the other way round.
    expect(resolveShot(at(-7, 0.9, { hand: -1 }), ask(), config).forehand).toBe(false);
    // The far team faces the other way: its right is on the left of the screen.
    expect(resolveShot({ ...at(7, 0.9), team: 1, playerY: 7.2, ballX: -0.6 }, ask(), config).forehand).toBe(true);
  });

  it('en el aire y cerca de la red es una volea', () => {
    expect(kind(at(-3, 1.2, { bounces: 0 }))).toBe('volley');
    // From the back of the court a ball in the air is still a groundstroke.
    expect(kind(at(-8.5, 1.2, { bounces: 0 }))).toBe('drive');
  });

  it('una pelota alta cerca de la red es un remate', () => {
    expect(kind(at(-3, 2.2, { bounces: 0 }))).toBe('smash');
    // It also is one after a high bounce.
    expect(kind(at(-3, 2.2))).toBe('smash');
  });

  it('una pelota alta a media cancha es una bandeja, o una víbora si se apunta abierto', () => {
    expect(kind(at(-6, 2.2, { bounces: 0 }))).toBe('bandeja');
    expect(kind(at(-6, 2.2, { bounces: 0 }), ask({ aim: 0.9 }))).toBe('vibora');
    expect(kind(at(-6, 2.2, { bounces: 0 }), ask({ aim: -0.9 }))).toBe('vibora');
  });

  it('después de la pared es una salida de pared', () => {
    expect(kind(at(-8.5, 0.8, { walls: 1 }))).toBe('wallExit');
  });

  it('si la pelota ya pasó al jugador cerca del fondo, es una contrapared', () => {
    // The ball is behind the player (closer to its own back wall) and near the glass.
    expect(kind(at(-9.2, 0.7, { playerY: -8.6 }))).toBe('backWall');
    expect(kind(at(-9.2, 0.7, { playerY: -8.6, walls: 1 }))).toBe('backWall');
    // In front of the player it is a normal shot, however close to the wall.
    expect(kind(at(-9.2, 0.7, { playerY: -9.5 }))).toBe('drive');
    // And far from the wall there is no glass to use.
    expect(kind(at(-5, 0.7, { playerY: -4.4 }))).toBe('drive');
  });

  it('pedir por arriba es un globo y pedir corto una chiquita, estés donde estés', () => {
    expect(kind(at(-7, 0.9), ask({ lob: true }))).toBe('lob');
    expect(kind(at(-3, 2.2, { bounces: 0 }), ask({ lob: true }))).toBe('lob');
    expect(kind(at(-7, 0.9), ask({ depth: 0.1 }))).toBe('drop');
    expect(kind(at(-3, 1.2, { bounces: 0 }), ask({ depth: 0.1 }))).toBe('drop');
  });

  it('apunta donde se pidió: el lado y la profundidad', () => {
    const left = resolveShot(at(-7, 0.9), ask({ aim: -1, depth: 1 }), config);
    const right = resolveShot(at(-7, 0.9), ask({ aim: 1, depth: 1 }), config);
    expect(left.targetX).toBeCloseTo(-config.shots.specs.drive.aimRange, 5);
    expect(right.targetX).toBeCloseTo(config.shots.specs.drive.aimRange, 5);
    expect(left.targetY).toBeCloseTo(config.shots.specs.drive.depthFar, 5);

    const shallow = resolveShot(at(-7, 0.9), ask({ depth: 0.4 }), config);
    expect(shallow.targetY).toBeLessThan(left.targetY);
    expect(shallow.targetY).toBeGreaterThan(config.shots.specs.drive.depthNear - 0.01);

    // The far team aims at the near half.
    const far = resolveShot({ ...at(7, 0.9), team: 1, playerY: 7.2 }, ask({ depth: 1 }), config);
    expect(far.targetY).toBeLessThan(0);
  });

  it('apuntar cerca de las paredes es más riesgo que apuntar al medio', () => {
    const middle = resolveShot(at(-7, 0.9), ask({ aim: 0, depth: 0.6 }), config);
    const corner = resolveShot(at(-7, 0.9), ask({ aim: 1, depth: 1 }), config);
    const wide = resolveShot(at(-7, 0.9), ask({ aim: 1, depth: 0.6 }), config);
    expect(middle.risk).toBe(0);
    expect(wide.risk).toBeGreaterThan(0.2);
    expect(corner.risk).toBeGreaterThan(wide.risk);
  });

  it('con menos fuerza la pelota va más lenta', () => {
    const full = resolveShot(at(-7, 0.9), ask(), config);
    const soft = resolveShot(at(-7, 0.9), ask({ power: 0.6 }), config);
    expect(soft.params.speed).toBeCloseTo(full.params.speed * 0.6, 5);
  });
});

describe('calidad del golpe', () => {
  const timing = config.timing;

  it('cerca del momento ideal es perfecto, un poco más lejos es bueno', () => {
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

  it('pegar temprano no se castiga: el golpe queda armado y sale como uno bueno', () => {
    expect(config.shots.quality.early).toEqual(config.shots.quality.good);
  });

  it('pegar tarde sale débil y alto, pero no descontrolado', () => {
    const { late, good } = config.shots.quality;
    expect(late.pace).toBeLessThan(good.pace);
    expect(late.lift).toBeGreaterThan(good.lift);
    expect(late.shorten).toBeGreaterThan(0);
    // The scatter of a late ball stays small: it is risk that sends balls out.
    expect(late.azimuth).toBeLessThan(good.azimuth * 2.5);
  });
});
