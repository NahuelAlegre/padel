import { describe, expect, it } from 'vitest';
import { CAST, CHARACTER_IDS } from '../src/characters/cast';
import { SIM_DT, createConfig, type AILevel } from '../src/config';
import { AIController } from '../src/control/ai';
import { autoMove } from '../src/control/autopilot';
import { Rng } from '../src/core/rng';
import { createBall, stepBall, type BallEvent, type BallState } from '../src/sim/ball';
import { contactNear, planIntercept, type InterceptPlan } from '../src/sim/intercept';
import { Match, type Controller, type PlayerEntry } from '../src/sim/match';
import { createPlayer, type Player } from '../src/sim/player';
import { backpedalOf, ballPressure, type BallAsk } from '../src/sim/pressure';
import { createRally, registerHit } from '../src/sim/rules';
import { resolveShot, solveShot, type ShotContext } from '../src/sim/shots';
import { pointAt, predictTrajectory } from '../src/sim/trajectory';
import type { PlayerIntent, Quality, ShotIntent } from '../src/sim/types';
import { aiEntry, HUMAN_HOLD_NET, HUMAN_REACH, humanEntry, LEVELS, playMatch, SKILLS, withTactics } from './helpers';

/**
 * Depth: what makes the right shot depend on the situation.
 * The mechanics are the ones of docs/profundidad.md; `npm run sim` measures
 * what they add up to.
 */
const config = createConfig();
const { player: pc, shots, physics } = config;

const intent = (more: Partial<ShotIntent> = {}): ShotIntent => ({ aim: 0, depth: 0.8, lob: false, power: 1, ...more });

/** A ball at height `ballZ`, `net` metres from the net on the near half, with the player beside it. */
const at = (ballZ: number, net: number, more: Partial<ShotContext> = {}): ShotContext => ({
  team: 0,
  hand: 1,
  playerX: 0,
  playerY: -net - 0.2,
  ballX: 0.6,
  ballY: -net,
  ballZ,
  bounces: 1,
  walls: 0,
  ...more,
});

describe('calidad de pelota: qué tan difícil es la que llega', () => {
  /** A ball nobody would complain about: waist high, slow, beside the body, at the back with room to swing. */
  const comfortable: BallAsk = {
    ballX: 0.6,
    ballY: 7,
    ballZ: 0.9,
    speed: 9,
    gap: pc.sweetSpot,
    reach: pc.reach + pc.lungeExtra,
    retreat: 0,
    risk: 0,
  };
  const pressure = (more: Partial<BallAsk> = {}): number => ballPressure({ ...comfortable, ...more }, config);

  it('una pelota cómoda no exige nada', () => {
    expect(pressure()).toBe(0);
  });

  it('más baja en la red, más estirada, más rápida o más pegada al vidrio: más difícil', () => {
    const rising = (values: number[]): void => {
      for (let i = 1; i < values.length; i++) expect(values[i]!, values.join(' < ')).toBeGreaterThan(values[i - 1]!);
    };
    // Under the tape, three metres from the net: it has to be hit upwards.
    rising([1.2, 0.8, 0.5, 0.3].map((ballZ) => pressure({ ballY: 3, ballZ })));
    rising([pc.sweetSpot, 1.2, 1.5, 1.8].map((gap) => pressure({ gap })));
    rising([10, 16, 19, 22].map((speed) => pressure({ speed })));
    rising([8.5, 9.4, 9.7, 9.9].map((ballY) => pressure({ ballY })));
    // The corner is worse than the back glass alone.
    expect(pressure({ ballY: 9.7, ballX: 4.7 })).toBeGreaterThan(pressure({ ballY: 9.7 }));
  });

  it('por debajo de la faja solo aprieta cerca de la red; contra el piso, en toda la cancha', () => {
    expect(pressure({ ballY: 3, ballZ: 0.75 })).toBeGreaterThan(0.1);
    expect(pressure({ ballY: 8, ballZ: 0.75 })).toBe(0);
    // The sliced volley that dies at the back: it has to be picked up from the floor.
    expect(pressure({ ballY: 8, ballZ: 0.2 })).toBeGreaterThan(0.3);
  });

  it('pegarle por arriba yendo para atrás', () => {
    expect(backpedalOf(3, 2.3, config)).toBe(1);
    expect(backpedalOf(1.5, 2.3, config)).toBeCloseTo(0.5);
    // Going forward, or with a ball that is not over the head, there is no backpedal.
    expect(backpedalOf(-3, 2.3, config)).toBe(0);
    expect(backpedalOf(3, 1.2, config)).toBe(0);
    expect(pressure({ ballZ: 2.3, retreat: 3 })).toBeGreaterThan(pressure({ ballZ: 2.3 }) + 0.2);
  });

  it('el riesgo que eligió el otro tiene premio: una pelota al rincón que entra es más difícil', () => {
    expect(pressure({ risk: 1 })).toBeGreaterThan(pressure({ risk: 0 }));
  });

  it('a una persona, con su alcance generoso, la misma pelota la estira menos', () => {
    const person = pc.reach * HUMAN_REACH + pc.lungeExtra;
    expect(pressure({ gap: 1.3, reach: person })).toBeLessThan(pressure({ gap: 1.3 }));
    // And getting more or less there is getting there: half way to the edge of the reach costs nothing.
    expect(pressure({ gap: 1.1, reach: person })).toBe(0);
  });

  it('siempre queda entre 0 y 1', () => {
    expect(pressure({ ballY: 9.9, ballX: 4.9, ballZ: 0.16, speed: 30, gap: 2, risk: 1 })).toBe(1);
  });
});

describe('una pelota difícil le baja el techo a la respuesta', () => {
  it('sale más lenta, más alta sobre la red, menos abierta y más corta', () => {
    const easy = resolveShot(at(0.9, 7), intent({ aim: 1, depth: 1 }), config);
    const hard = resolveShot(at(0.9, 7, { pressure: 0.8 }), intent({ aim: 1, depth: 1 }), config);
    expect(hard.kind).toBe(easy.kind);
    expect(hard.params.speed).toBeLessThan(easy.params.speed * 0.8);
    expect(hard.params.clearance).toBeGreaterThan(easy.params.clearance + 0.5);
    expect(Math.abs(hard.targetX)).toBeLessThan(Math.abs(easy.targetX) * 0.7);
    expect(Math.abs(hard.targetY)).toBeLessThan(Math.abs(easy.targetY) - 1);
  });

  it('una volea a 30 cm del piso en la red sale más lenta y más alta que una a la altura del pecho', () => {
    const volley = (ballZ: number) => {
      const pressure = ballPressure(
        { ballX: 0.6, ballY: -2.5, ballZ, speed: 11, gap: pc.sweetSpot, reach: pc.reach + pc.lungeExtra, retreat: 0, risk: 0 },
        config,
      );
      return resolveShot(at(ballZ, 2.5, { bounces: 0, pressure }), intent(), config);
    };
    const low = volley(0.3);
    const chest = volley(1.2);
    expect(low.kind).toBe('volley');
    expect(chest.kind).toBe('volley');
    expect(low.params.speed).toBeLessThan(chest.params.speed * 0.9);
    expect(low.params.clearance).toBeGreaterThan(chest.params.clearance + 0.3);
  });

  it('la chiquita no se acorta más: ya es la pelota corta', () => {
    const easy = resolveShot(at(0.9, 7), intent({ depth: 0.1 }), config);
    const hard = resolveShot(at(0.9, 7, { pressure: 0.8 }), intent({ depth: 0.1 }), config);
    expect(hard.kind).toBe('drop');
    expect(Math.abs(hard.targetY)).toBeCloseTo(Math.abs(easy.targetY));
  });
});

describe('globo con calidad: la profundidad sale de la ejecución, no del pulgar', () => {
  const lob = (quality: Quality, pressure = 0, depth = 1) =>
    resolveShot(at(0.9, 8, { pressure }), intent({ lob: true, depth }), config, quality);
  const depthOf = (quality: Quality, pressure = 0): number => Math.abs(lob(quality, pressure).targetY);

  it('perfecto pica junto al vidrio; tarde, donde se remata', () => {
    expect(depthOf('perfect')).toBeGreaterThan(9);
    expect(depthOf('late')).toBeLessThan(7.5);
    // One that is only good still does its job: it lands past the service line.
    expect(depthOf('good')).toBeGreaterThan(8);
    expect(depthOf('good')).toBeLessThan(depthOf('perfect') - 0.5);
    // Arming it early is safe, and a little less than timing it.
    expect(depthOf('early')).toBeLessThanOrEqual(depthOf('good'));
    expect(depthOf('early')).toBeGreaterThan(7.5);
  });

  it('cuánto se arrastra el pulgar hacia arriba no cambia dónde cae', () => {
    expect(lob('good', 0, 0.3).targetY).toBeCloseTo(lob('good', 0, 1).targetY);
  });

  it('exigido, el globo queda corto: el mismo globo perfecto ya no pasa al que está en la red', () => {
    expect(depthOf('perfect', 0.5)).toBeLessThan(depthOf('perfect') - 1.5);
    expect(depthOf('good', 0.8)).toBeLessThan(6.5);
    expect(lob('perfect', 0.5).lobQuality).toBeLessThan(lob('perfect').lobQuality);
  });

  it('el mejor globo también vuela más alto', () => {
    expect(lob('perfect').params.apex).toBeGreaterThan(lob('good').params.apex);
    expect(lob('good').params.apex).toBeGreaterThan(lob('late').params.apex);
  });

  it('en la cancha: el perfecto pica a más de 9 m de la red y el tardío a menos de 7,5', () => {
    const landing = (quality: Quality): number => {
      const shot = lob(quality);
      const launch = solveShot(0.6, -8, 0.9, shot.targetX, shot.targetY, shot.params, physics, config.court);
      const ball: BallState = { ...createBall(), x: 0.6, y: -8, z: 0.9, vx: launch.vx, vy: launch.vy, vz: launch.vz };
      const events: BallEvent[] = [];
      for (let i = 0; i < 120 * 5; i++) {
        stepBall(ball, SIM_DT, physics, config.court, events);
        const floor = events.find((event) => event.type === 'floor');
        if (floor && floor.type === 'floor') return floor.y;
      }
      throw new Error('The lob never came down');
    };
    expect(landing('perfect')).toBeGreaterThan(9);
    expect(landing('late')).toBeLessThan(7.5);
  });
});

describe('el perfecto de cada golpe', () => {
  const both = (context: ShotContext, ask: ShotIntent) => ({
    good: resolveShot(context, ask, config, 'good'),
    perfect: resolveShot(context, ask, config, 'perfect'),
  });

  it('derecha, revés y volea: más ritmo y más baja sobre la red', () => {
    for (const context of [at(0.9, 7), at(1.2, 3, { bounces: 0 })]) {
      const { good, perfect } = both(context, intent());
      expect(perfect.params.speed).toBeGreaterThan(good.params.speed * 1.1);
      expect(perfect.params.clearance).toBeLessThan(good.params.clearance - 0.15);
    }
  });

  it('chiquita: más corta, más suave y muerde más', () => {
    const { good, perfect } = both(at(0.9, 7), intent({ depth: 0.1 }));
    expect(perfect.kind).toBe('drop');
    expect(Math.abs(perfect.targetY)).toBeLessThan(Math.abs(good.targetY) - 0.4);
    expect(perfect.params.speed).toBeLessThan(good.params.speed);
    expect(perfect.grip).toBeLessThan(good.grip);
  });

  it('bandeja: más profunda y más baja', () => {
    const { good, perfect } = both(at(2.1, 5.5, { bounces: 0 }), intent());
    expect(perfect.kind).toBe('bandeja');
    expect(Math.abs(perfect.targetY)).toBeGreaterThan(Math.abs(good.targetY) + 0.5);
    expect(perfect.params.clearance).toBeLessThan(good.params.clearance);
  });

  it('víbora: más ritmo y más abierta', () => {
    const { good, perfect } = both(at(2.1, 5.5, { bounces: 0 }), intent({ aim: 1 }));
    expect(perfect.kind).toBe('vibora');
    expect(perfect.params.speed).toBeGreaterThan(good.params.speed * 1.1);
    expect(Math.abs(perfect.targetX)).toBeGreaterThan(Math.abs(good.targetX));
  });

  it('salida de pared: no flota', () => {
    const { good, perfect } = both(at(0.9, 8.5, { walls: 1 }), intent());
    expect(perfect.kind).toBe('wallExit');
    expect(perfect.params.clearance).toBeLessThan(good.params.clearance - 0.3);
  });

  it('remate: salta todavía más', () => {
    const { good, perfect } = both(at(2.5, 3, { bounces: 0 }), intent());
    expect(perfect.kind).toBe('smash');
    expect(perfect.kick).toBeGreaterThan(good.kick);
  });

  it('ningún perfecto se pide tan justo que sea un error', () => {
    for (const context of [at(0.9, 7), at(1.2, 3, { bounces: 0 }), at(2.5, 3, { bounces: 0 }), at(0.9, 8.5, { walls: 1 })]) {
      for (const ask of [intent(), intent({ depth: 0.1 }), intent({ lob: true })]) {
        expect(resolveShot(context, ask, config, 'perfect').params.clearance).toBeGreaterThanOrEqual(shots.minClearance);
      }
    }
  });
});

describe('golpes por arriba', () => {
  it('yendo para atrás nunca es un remate: es una bandeja, o una víbora', () => {
    const high = { bounces: 0 };
    expect(resolveShot(at(2.5, 3, { ...high, backpedal: 0.3 }), intent(), config).kind).toBe('smash');
    expect(resolveShot(at(2.5, 3, { ...high, backpedal: 0.8 }), intent(), config).kind).toBe('bandeja');
    expect(resolveShot(at(2.5, 3, { ...high, backpedal: 0.8 }), intent({ aim: 0.9 }), config).kind).toBe('vibora');
  });

  it('para rematar la pelota tiene que estar alta y cerca de la red', () => {
    const kind = (ballZ: number, net: number): string => resolveShot(at(ballZ, net, { bounces: 0 }), intent(), config).kind;
    expect(kind(2.4, 3)).toBe('smash');
    // Head high is no smash: there is no room to hit it down.
    expect(kind(2.0, 3)).toBe('bandeja');
    // From further back it does not go down either.
    expect(kind(2.4, 5.5)).toBe('bandeja');
    // And from the back of the court there is no overhead at all.
    expect(kind(2.4, 7.5)).not.toBe('bandeja');
    expect(kind(2.4, 7.5)).not.toBe('smash');
  });
});

describe('efecto: lo que hace el primer pique', () => {
  /** A ball coming down on the floor at `vz`, moving forward at `vy`. */
  const falling = (more: Partial<BallState>): BallState => ({ ...createBall(), x: 0, y: 3, z: 0.2, vy: 10, vz: -8, ...more });
  const bounce = (ball: BallState): BallState => {
    const events: BallEvent[] = [];
    for (let i = 0; i < 60 && !events.some((event) => event.type === 'floor'); i++) stepBall(ball, SIM_DT, physics, config.court, events);
    return ball;
  };

  it('el remate salta: su pique conserva más altura, y solo ese pique', () => {
    const plain = bounce(falling({}));
    const smash = bounce(falling({ kick: 0.9 }));
    expect(smash.vz).toBeGreaterThan(plain.vz * 1.2);
    expect(smash.vz / plain.vz).toBeCloseTo(0.9 / physics.floorRestitution, 1);
    expect(smash.kick).toBe(0);
  });

  it('la chiquita muerde: pica y se queda', () => {
    const plain = bounce(falling({}));
    const drop = bounce(falling({ grip: 0.5 }));
    expect(drop.vy).toBeCloseTo(5, 1);
    expect(plain.vy).toBeCloseTo(10 * physics.floorGrip, 1);
    expect(drop.grip).toBe(0);
  });

  it('cada golpe sale con su efecto, y exigido lo pierde', () => {
    const smash = resolveShot(at(2.5, 3, { bounces: 0 }), intent(), config);
    expect(smash.kick).toBeCloseTo(shots.spin.smash!.kick!);
    expect(resolveShot(at(2.5, 3, { bounces: 0, pressure: 1 }), intent(), config).kick).toBeCloseTo(physics.floorRestitution);
    const drop = resolveShot(at(0.9, 7), intent({ depth: 0.1 }), config);
    expect(drop.grip).toBeCloseTo(shots.spin.drop!.grip!);
    expect(resolveShot(at(0.9, 7, { pressure: 1 }), intent({ depth: 0.1 }), config).grip).toBeCloseTo(physics.floorGrip);
    // The volley and the bandeja are sliced: they stay low.
    expect(resolveShot(at(1.2, 3, { bounces: 0 }), intent(), config).kick).toBeLessThan(physics.floorRestitution);
    expect(resolveShot(at(2.1, 5.5, { bounces: 0 }), intent(), config).kick).toBeLessThan(physics.floorRestitution);
    // A plain groundstroke has none.
    const drive = resolveShot(at(0.9, 7), intent(), config);
    expect(drive.kick).toBe(0);
    expect(drive.grip).toBe(0);
  });

  it('la predicción conoce el efecto: la marca de pique sigue siendo exacta', () => {
    const shot = resolveShot(at(2.5, 3, { bounces: 0 }), intent({ aim: 0.5 }), config);
    const launch = solveShot(0.6, -3, 2.5, shot.targetX, shot.targetY, shot.params, physics, config.court);
    const ball: BallState = { ...createBall(), x: 0.6, y: -3, z: 2.5, vx: launch.vx, vy: launch.vy, vz: launch.vz, kick: shot.kick };
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    const predicted = predictTrajectory(ball, rally, 0, config);
    const events: BallEvent[] = [];
    const floors: Array<{ x: number; y: number }> = [];
    for (let i = 1; i < predicted.points.length; i++) {
      events.length = 0;
      stepBall(ball, SIM_DT, physics, config.court, events);
      for (const event of events) if (event.type === 'floor') floors.push({ x: event.x, y: event.y });
      const point = predicted.points[i]!;
      expect(ball.z).toBeCloseTo(point.z, 9);
      expect(ball.y).toBeCloseTo(point.y, 9);
    }
    expect(floors.length).toBeGreaterThan(0);
    expect(predicted.bounces[0]!.x).toBeCloseTo(floors[0]!.x, 9);
    expect(predicted.bounces[0]!.y).toBeCloseTo(floors[0]!.y, 9);
    // And it is the bounce of a smash: over two metres at the back glass.
    const wall = predicted.points.find((point) => point.walls > 0);
    expect(wall!.z).toBeGreaterThan(2);
  });

  it('un remate de cerca vuelve a pasar la red por arriba de todos', () => {
    const shot = resolveShot(at(2.5, 3, { bounces: 0 }), intent(), config);
    const launch = solveShot(0.6, -3, 2.5, shot.targetX, shot.targetY, shot.params, physics, config.court);
    const ball: BallState = { ...createBall(), x: 0.6, y: -3, z: 2.5, vx: launch.vx, vy: launch.vy, vz: launch.vz, kick: shot.kick };
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    const flight = predictTrajectory(ball, rally, 0, config);
    expect(flight.end?.result).toMatchObject({ kind: 'point', winner: 0, reason: 'overNet' });
    // Once it has left the glass it is out of reach until it is gone.
    const wallAt = flight.points.findIndex((point) => point.walls > 0);
    const late = flight.points.slice(wallAt + 40);
    expect(late.length).toBeGreaterThan(10);
    for (const point of late) expect(point.z).toBeGreaterThan(pc.maxContactZ);
  });
});

/** A lob just struck by team 0 from the back, landing `depth` metres past the net. */
function lobTo(depth: number, x = 0.3) {
  const launch = solveShot(0, -7, 0.9, x, depth, shots.specs.lob, physics, config.court);
  const ball: BallState = { ...createBall(), x: 0, y: -7, z: 0.9, vx: launch.vx, vy: launch.vy, vz: launch.vz };
  const rally = createRally();
  registerHit(rally, 0, false, 1);
  return predictTrajectory(ball, rally, 0, config);
}

function receiver(x: number, y: number, more: Partial<PlayerEntry> = {}): Player {
  const player = createPlayer(1, 1, 0, {
    name: 'R',
    isHuman: false,
    manual: false,
    speedFactor: 1,
    reaction: 0,
    errorScale: 1,
    reachScale: 1,
    hand: 1,
    ...more,
  });
  player.x = x;
  player.y = y;
  return player;
}

describe('una red que se defiende', () => {
  /** The contact a hand-moved player gets while the lob comes down, from where it is and how it moves. */
  const contactOf = (player: Player, trajectory: ReturnType<typeof lobTo>): InterceptPlan | null => {
    let found: InterceptPlan | null = null;
    // The lob takes about two seconds to come down: look for the first contact on the way.
    for (let t = 1.2; t < 2.2 && !found; t += 0.05) found = contactNear(trajectory, player, t, config);
    return found;
  };
  const kindOf = (player: Player, trajectory: ReturnType<typeof lobTo>, plan: InterceptPlan): string => {
    const point = pointAt(trajectory, plan.t)!;
    return resolveShot(
      { team: 1, hand: 1, playerX: player.x, playerY: player.y, ballX: plan.x, ballY: plan.y, ballZ: plan.z, bounces: point.bounces, walls: point.walls },
      intent({ aim: 0 }),
      config,
    ).kind;
  };

  it('quien aguanta juega el globo por arriba: bandeja', () => {
    // A good lob, eight metres deep. Two steps back from the net it comes down within reach.
    const trajectory = lobTo(8.2);
    const person = receiver(0.9, 5.2, { isHuman: true, manual: true, reachScale: HUMAN_REACH });
    const plan = contactOf(person, trajectory)!;
    expect(plan).not.toBeNull();
    expect(plan.kind).toBe('volley');
    expect(plan.z).toBeGreaterThanOrEqual(pc.overheadZ);
    expect(kindOf(person, trajectory, plan)).toBe('bandeja');
  });

  it('el mismo jugador corriendo al fondo la deja pasar: le queda la salida de pared', () => {
    const trajectory = lobTo(8.2);
    const person = receiver(0.9, 5.2, { isHuman: true, manual: true, reachScale: HUMAN_REACH });
    // Running back: for the far team that is toward +y.
    person.vy = 4.5;
    for (let t = 1.2; t < 2.0; t += 0.05) {
      const plan = contactNear(trajectory, person, t, config);
      if (plan) expect(plan.z < pc.overheadZ || pointAt(trajectory, plan.t)!.bounces > 0).toBe(true);
    }
    // Once it is at the back and has stopped, the ball it gets is the one off the glass.
    person.y = 7.4;
    person.vy = 0;
    let plan: InterceptPlan | null = null;
    for (let t = 2.4; t < 4 && !plan; t += 0.05) plan = contactNear(trajectory, person, t, config);
    expect(plan).not.toBeNull();
    expect(kindOf(person, trajectory, plan!)).toBe('wallExit');
  });

  it('un globo perfecto no se alcanza desde la red: hay que irse atrás', () => {
    const trajectory = lobTo(9.3);
    const person = receiver(0.9, 5.2, { isHuman: true, manual: true, reachScale: HUMAN_REACH });
    // While it comes down there is nothing to hit: it goes over out of reach.
    for (let t = 1.0; t < 1.9; t += 0.05) {
      const plan = contactNear(trajectory, person, t, config, 0.3);
      if (plan) expect(pointAt(trajectory, plan.t)!.bounces).toBeGreaterThan(0);
    }
  });

  it('un globo corto, en cambio, se remata', () => {
    const trajectory = lobTo(5.6);
    const person = receiver(0.9, 3.2, { isHuman: true, manual: true, reachScale: HUMAN_REACH });
    const plan = contactOf(person, trajectory)!;
    expect(plan.kind).toBe('volley');
    // It is met as high as it can be reached: that is what lets it be hit down.
    expect(plan.z).toBeGreaterThanOrEqual(pc.smashZ);
    expect(kindOf(person, trajectory, plan)).toBe('smash');
  });

  it('la IA que quiere la red la aguanta; la que no, espera el vidrio', () => {
    const trajectory = lobTo(8.2);
    const holder = planIntercept(trajectory, receiver(0.9, 3.4, { holdNet: 1 }), 0.3, config)!;
    expect(holder.kind).toBe('volley');
    expect(holder.z).toBeGreaterThanOrEqual(pc.overheadZ);
    expect(Math.abs(holder.stanceY)).toBeLessThanOrEqual(pc.holdNetDistance);
    const waiter = planIntercept(trajectory, receiver(0.9, 3.4, { holdNet: 0, wallBias: 0.5 }), 0.3, config)!;
    expect(waiter.kind).toBe('wall');
  });

  it('desde el fondo no hay red que aguantar', () => {
    const trajectory = lobTo(8.2);
    const back = planIntercept(trajectory, receiver(0.9, 7.6, { holdNet: 1, wallBias: 0.5 }), 0.3, config)!;
    expect(back.kind).toBe('wall');
  });
});

describe('presión acumulada', () => {
  it('la tensión de cada uno sale de las pelotas difíciles que le tocan, y cada punto empieza de cero', () => {
    // A match long enough for a few hundred balls.
    const long = createConfig();
    long.rules.format.gamesToWin = 6;
    const match = new Match({
      config: long,
      seed: 21,
      teams: [
        { name: 'A', players: [aiEntry(config, 'romina', 3)] },
        { name: 'B', players: [aiEntry(config, 'chela', 4)] },
      ],
    });
    const { carry } = match.config.rules.strain;
    const expected = match.players.map(() => 0);
    let hits = 0;
    let hard = 0;
    let top = 0;
    for (let i = 0; i < 120 * 480 && match.phase !== 'matchOver'; i++) {
      match.step();
      for (const event of match.events) {
        if (event.type === 'serveReady') {
          expected.fill(0);
          for (const player of match.players) expect(player.strain).toBe(0);
        } else if (event.type === 'hit' && event.kind !== 'serve') {
          hits++;
          expect(event.pressure).toBeGreaterThanOrEqual(0);
          expect(event.pressure).toBeLessThanOrEqual(1);
          if (event.pressure >= 0.3) hard++;
          expected[event.player] = expected[event.player]! * carry + event.pressure;
          // Only whoever hit carries what that ball did; the other side is as it was.
          for (const player of match.players) expect(player.strain).toBeCloseTo(expected[player.id]!, 9);
          top = Math.max(top, match.players[event.player]!.strain);
        }
      }
      match.events.length = 0;
    }
    expect(hits).toBeGreaterThan(100);
    // There were difficult balls, and a run of them added up.
    expect(hard).toBeGreaterThan(10);
    expect(top).toBeGreaterThan(match.config.rules.strain.from);
  });

  it('a quien tiene poca entereza la tensión lo desordena más', () => {
    // Scatter is what moves a ball off its target. Same ball, same shot: only the strain and the composure change.
    const spread = (composure: number, tension: number): number => {
      const offs: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        const puppet = new Returner(tension);
        const match = new Match({
          config: createConfig(),
          seed,
          teams: [
            { name: 'A', players: [plainEntry(new Server())] },
            { name: 'B', players: [plainEntry(puppet, { errorScale: 1, composure })] },
          ],
        });
        for (let i = 0; i < 120 * 12 && puppet.landedX === null; i++) {
          match.step();
          for (const event of match.events) {
            if (event.type === 'hit' && event.team === 1) puppet.landedX = match.trajectory?.bounces[0]?.x ?? 0;
          }
          match.events.length = 0;
        }
        if (puppet.landedX !== null) offs.push(Math.abs(puppet.landedX));
      }
      expect(offs.length).toBeGreaterThan(30);
      return offs.reduce((a, b) => a + b, 0) / offs.length;
    };
    const calm = spread(0.9, 0);
    const steady = spread(0.9, 2);
    const rattled = spread(0.1, 2);
    expect(rattled).toBeGreaterThan(steady * 1.3);
    expect(rattled).toBeGreaterThan(calm * 1.5);
  });
});

/** Serves down the middle and then stands still. */
class Server implements Controller {
  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (match.phase === 'serve' && match.serverId === me.id) intent.swing = { aim: 0, depth: 0.6, lob: false, power: 1 };
  }
}

/** Returns the serve down the middle, on time, bringing `tension` to the swing. */
class Returner implements Controller {
  landedX: number | null = null;
  constructor(private readonly tension: number) {}
  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
    const plan = me.plan;
    if (plan && !me.swing && match.time >= plan.t) intent.swing = { aim: 0, depth: 0.6, lob: false, power: 1, tension: this.tension };
  }
}

function plainEntry(controller: Controller, more: Partial<PlayerEntry> = {}): PlayerEntry {
  return { name: 'T', isHuman: false, manual: false, speedFactor: 1, reaction: 0, errorScale: 0, reachScale: 1, hand: 1, controller, ...more };
}

describe('la IA juega al pádel', () => {
  const pick = (level: AILevel, seed = 8) => {
    const controller = new AIController(level, new Rng(seed));
    const choose = (controller as unknown as { chooseShot: (m: Match, p: Player, plan: unknown) => ShotIntent }).chooseShot.bind(controller);
    const match = new Match({
      config: createConfig(),
      seed: 5,
      teams: [
        { name: 'A', players: [plainEntry(new Server())] },
        { name: 'B', players: [plainEntry(controller)] },
      ],
    });
    return { choose, match, me: match.players[1]!, rival: match.players[0]! };
  };
  /** A floating ball met at the net, chest high and with time: one to attack. */
  const sitter = { trajId: 1, t: 1, x: 0.5, y: 3, z: 1.4, stanceX: 0, stanceY: 3.2, kind: 'volley', reachable: true, slack: 0.5 };

  it('quien castiga define la pelota fácil: lejos del otro y sin darle el vidrio; quien no, la devuelve al medio y sin apuro', () => {
    const level = { ...LEVELS.hard, lobChance: 0, dropChance: 0, feed: 0, angle: 1 };
    const punisher = pick({ ...level, punish: 1 });
    punisher.rival.x = 3;
    punisher.rival.y = -7.4;
    const soft = pick({ ...level, punish: 0 });
    soft.rival.x = 3;
    soft.rival.y = -7.4;
    for (let i = 0; i < 30; i++) {
      const finish = punisher.choose(punisher.match, punisher.me, sitter);
      expect(finish.lob).toBe(false);
      // Not deep: with the other one at the back, a deep ball comes back off the glass. This one dies in the side fence.
      expect(finish.depth).toBeGreaterThanOrEqual(0.3);
      expect(finish.depth).toBeLessThanOrEqual(0.55);
      // Away from where the other one is standing.
      expect(finish.aim).toBeLessThan(-0.3);
      expect(finish.power).toBeCloseTo(level.power);
      const back = soft.choose(soft.match, soft.me, sitter);
      expect(Math.abs(back.aim)).toBeLessThanOrEqual(0.6);
      expect(back.power).toBeLessThan(level.power);
    }
    // With the other one at the net there is no fence to use: deep, past them.
    punisher.rival.y = -3;
    for (let i = 0; i < 10; i++) expect(punisher.choose(punisher.match, punisher.me, sitter).depth).toBeGreaterThanOrEqual(0.85);
  });

  it('sube detrás del globo recién cuando lo ve pasar', () => {
    // It always lobs somebody at the net and always follows its lobs. The other side serves, walks to the net and stays there.
    const level = { ...LEVELS.hard, lobChance: 1, smart: 1, feed: 0, netRush: 1, dropChance: 0, timingSigma: 0 };
    const controller = new AIController(level, new Rng(3));
    const match = new Match({
      config: createConfig(),
      seed: 9,
      teams: [
        { name: 'Estatua', players: [plainEntry(new NetStatue())] },
        { name: 'IA', players: [plainEntry(controller)] },
      ],
    });
    const me = match.players[1]!;
    let lobs = 0;
    let followed = 0;
    let waiting = false;
    for (let i = 0; i < 120 * 60; i++) {
      // What it decided on the previous step is where it is waiting now.
      const flying = waiting && match.rally.live && match.rally.hitter === 1;
      const past = flying && match.rally.bounces >= 1;
      match.step();
      if (flying && !past && match.rally.live && match.rally.bounces === 0) expect(me.homeMode).toBe('back');
      if (past && match.rally.live && match.rally.hitter === 1) {
        expect(me.homeMode).toBe('net');
        followed++;
      }
      for (const event of match.events) {
        if (event.type === 'hit' && event.team === 1) {
          waiting = event.kind === 'lob';
          if (waiting) lobs++;
        } else if (event.type === 'hit' || event.type === 'point') {
          waiting = false;
        }
      }
      match.events.length = 0;
    }
    expect(lobs).toBeGreaterThan(3);
    expect(followed).toBeGreaterThan(3);
  });

  it('justicia: no lee el pulgar. Lo que hace no cambia con lo que la persona tiene armado', () => {
    // Two matches that only differ in where the person is aiming before it hits.
    const play = (aim: number) => {
      const person = new Armed(aim);
      const match = new Match({
        config: createConfig(),
        seed: 77,
        firstServer: 1,
        teams: [
          { name: 'Vos', players: [plainEntry(person, { isHuman: true, reachScale: HUMAN_REACH, errorScale: 1 })] },
          { name: 'Chela', players: [aiEntry(config, 'chela', 12)] },
        ],
      });
      const trace: number[] = [];
      let returned = false;
      for (let i = 0; i < 120 * 20 && !returned; i++) {
        match.step();
        const rival = match.players[1]!;
        trace.push(rival.x, rival.y, rival.vx, rival.vy, rival.homeMode === 'net' ? 1 : 0, rival.cue ? 1 : 0);
        returned = match.events.some((event) => event.type === 'hit' && event.team === 0);
        match.events.length = 0;
      }
      expect(returned).toBe(true);
      expect(person.armedFor).toBeGreaterThan(20);
      return trace;
    };
    const left = play(-1);
    const right = play(1);
    expect(left.length).toBe(right.length);
    expect(left).toEqual(right);
  });

  it('sin azar puro: nadie erra porque sí, y nadie corre más que una persona', () => {
    for (const id of CHARACTER_IDS) {
      const level = config.rivals[id];
      expect(level.mishit, id).toBe(0);
      expect(level.speedFactor, id).toBeGreaterThanOrEqual(0.75);
      expect(level.speedFactor, id).toBeLessThanOrEqual(1);
      for (const key of ['smart', 'punish', 'netRush', 'holdNet', 'composure'] as const) {
        expect(level[key], `${id} ${key}`).toBeGreaterThanOrEqual(0);
        expect(level[key], `${id} ${key}`).toBeLessThanOrEqual(1);
      }
    }
    // More stars is playing better padel, not being quicker.
    expect(config.rivals.chela.smart).toBeGreaterThan(config.rivals.beto.smart);
    expect(config.rivals.chela.composure).toBeGreaterThan(config.rivals.romina.composure);
    expect(CAST.chela.stars).toBeGreaterThan(CAST.beto.stars);
  });
});

/** Serves, walks to the net and stands there without ever swinging again. */
class NetStatue implements Controller {
  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (match.phase === 'serve' && match.serverId === me.id) intent.swing = { aim: 0, depth: 0.6, lob: false, power: 1 };
    if (match.phase !== 'rally') return;
    intent.hasTarget = true;
    intent.targetX = 0;
    intent.targetY = me.team === 0 ? -3.2 : 3.2;
  }
}

/** A person with assisted movement who arms the return early, aiming to one side. */
class Armed implements Controller {
  armedFor = 0;
  constructor(private readonly aim: number) {}
  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
    if (me.swing) this.armedFor++;
    const plan = me.plan;
    // As soon as it knows which ball it is waiting for: well before the contact.
    if (plan && !me.swing && match.time >= plan.t - 0.6) intent.swing = { aim: this.aim, depth: 0.9, lob: false, power: 1 };
  }
}

describe('jugar con táctica paga', () => {
  /** Points won by a simulated average person against Chela over a few matches, with the same hands. */
  const share = (tactics: number): { points: number; net: number; held: number } => {
    let won = 0;
    let all = 0;
    let atNet = 0;
    let hits = 0;
    let held = 0;
    for (let i = 0; i < 4; i++) {
      const cfg = createConfig();
      const match = new Match({
        config: cfg,
        seed: 500 + i,
        firstServer: i % 2 === 0 ? 0 : 1,
        teams: [
          { name: 'Vos', players: [humanEntry(1000 + i * 7, withTactics(SKILLS.average, tactics))] },
          { name: 'Chela', players: [aiEntry(cfg, 'chela', 1001 + i * 7)] },
        ],
      });
      let lastRivalKind = '';
      const summary = playMatch(match, 3600, (event) => {
        if (event.type !== 'hit' || event.kind === 'serve') return;
        if (event.team === 1) {
          lastRivalKind = event.kind;
          return;
        }
        hits++;
        if (Math.abs(match.players[0]!.y) < 5) atNet++;
        // A lob of hers taken in the air instead of off the glass: the net was held.
        if (lastRivalKind === 'lob' && event.volley) held++;
        lastRivalKind = '';
      });
      won += summary.pointsWon[0];
      all += summary.points;
    }
    return { points: won / all, net: atNet / hits, held };
  };

  it('con las mismas manos, quien sube a la red y elige el golpe le saca más puntos a Chela', () => {
    const plain = share(0);
    const thinking = share(1);
    expect(thinking.points).toBeGreaterThan(plain.points + 0.08);
    // And it is a different match: much more of it is played at the net, holding it against her lobs.
    expect(thinking.net).toBeGreaterThan(plain.net + 0.1);
    expect(thinking.held).toBeGreaterThan(5);
  });

  it('el consejo de dónde pararse le dice a la persona que aguante la red', () => {
    expect(HUMAN_HOLD_NET).toBeGreaterThan(0);
    const trajectory = lobTo(8.2);
    const person = receiver(0.9, 3.4, { isHuman: true, manual: true, reachScale: HUMAN_REACH, holdNet: HUMAN_HOLD_NET });
    const advice = planIntercept(trajectory, person, 0.2, config)!;
    expect(advice.kind).toBe('volley');
    expect(Math.abs(advice.stanceY)).toBeLessThanOrEqual(pc.holdNetDistance);
  });
});
