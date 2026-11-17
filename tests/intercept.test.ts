import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config';
import { createBall, type BallState } from '../src/sim/ball';
import { contactNear, planIntercept } from '../src/sim/intercept';
import { Match, type SimEvent } from '../src/sim/match';
import { createPlayer, type Player } from '../src/sim/player';
import { createRally, registerHit } from '../src/sim/rules';
import { solveShot } from '../src/sim/shots';
import { predictTrajectory, pointAt } from '../src/sim/trajectory';
import { aiEntry, playMatch } from './helpers';

const config = createConfig();

/** A ball just struck by team 0 from (x0, y0, z0) toward a landing point on the far half. */
function shot(x0: number, y0: number, z0: number, tx: number, ty: number, kind: 'drive' | 'lob' | 'drop' | 'smash') {
  const launch = solveShot(x0, y0, z0, tx, ty, config.shots.specs[kind], config.physics, config.court);
  const ball: BallState = { ...createBall(), x: x0, y: y0, z: z0, vx: launch.vx, vy: launch.vy, vz: launch.vz };
  const rally = createRally();
  registerHit(rally, 0, false, 1);
  return predictTrajectory(ball, rally, 0, config);
}

/** A receiver of team 1 standing at (x, y). */
function receiver(x: number, y: number): Player {
  const player = createPlayer(1, 1, 0, {
    name: 'R',
    isHuman: false,
    manual: false,
    speedFactor: 1,
    reaction: 0,
    errorScale: 1,
    hand: 1,
  });
  player.x = x;
  player.y = y;
  return player;
}

describe('dónde y cuándo pegarle', () => {
  it('a una pelota corta se le pega después del pique, sin esperar ninguna pared', () => {
    // It lands three metres past the net: from the back there is no time to volley it.
    const trajectory = shot(0, -7, 0.9, 1, 3, 'drive');
    const plan = planIntercept(trajectory, receiver(0, 7.4), 0, config)!;
    expect(plan.reachable).toBe(true);
    expect(plan.kind).toBe('bounce');
    expect(plan.t).toBeGreaterThan(trajectory.bounces[0]!.t);
    expect(plan.t).toBeLessThan(trajectory.bounces[1]!.t);
  });

  it('un drive profundo se juega después del rebote en el vidrio del fondo', () => {
    // It lands a metre and a half from the back wall: no time to hit it before the glass.
    const trajectory = shot(0, -7, 0.9, 1, 8.6, 'drive');
    const plan = planIntercept(trajectory, receiver(0, 7.4), 0, config)!;
    expect(plan.reachable).toBe(true);
    expect(plan.kind).toBe('wall');

    // The contact is after the bounce and after the wall, with the ball coming back out.
    const at = pointAt(trajectory, plan.t)!;
    expect(at.bounces).toBe(1);
    expect(at.walls).toBeGreaterThanOrEqual(1);
    expect(at.vy).toBeLessThan(0);
    expect(plan.y).toBeLessThan(config.court.halfLength - 0.5);
    // And it is a comfortable ball: between the knees and the shoulders.
    expect(plan.z).toBeGreaterThan(0.4);
    expect(plan.z).toBeLessThan(1.6);
  });

  it('en la red, un drive se volea', () => {
    const trajectory = shot(0, -7, 0.9, 0.5, 7.4, 'drive');
    const plan = planIntercept(trajectory, receiver(0.5, 3.2), 0, config)!;
    expect(plan.reachable).toBe(true);
    expect(plan.kind).toBe('volley');
    expect(plan.y).toBeLessThan(5);
  });

  it('un globo corto se remata por arriba cerca de la red', () => {
    const trajectory = shot(0, -7, 0.9, 0, 4.5, 'lob');
    const plan = planIntercept(trajectory, receiver(0, 3.2), 0, config)!;
    expect(plan.reachable).toBe(true);
    expect(plan.z).toBeGreaterThanOrEqual(config.player.smashZ);
    expect(Math.abs(plan.y)).toBeLessThanOrEqual(config.player.smashMaxNetDistance);
  });

  it('el jugador se para con la pelota a un costado, a la distancia del golpe', () => {
    const trajectory = shot(0, -7, 0.9, 2, 7, 'drive');
    const plan = planIntercept(trajectory, receiver(0, 7.4), 0, config)!;
    const gap = Math.hypot(plan.x - plan.stanceX, plan.y - plan.stanceY);
    expect(gap).toBeGreaterThan(0.3);
    expect(gap).toBeLessThanOrEqual(config.player.reach);
    // Never inside a wall or over the net.
    expect(Math.abs(plan.stanceX)).toBeLessThanOrEqual(config.court.halfWidth - config.player.radius);
    expect(plan.stanceY).toBeGreaterThanOrEqual(config.player.netGap);
  });

  it('si no llega, igual corre hacia la pelota, y el plan lo dice', () => {
    // A drop shot with the receiver glued to the far back corner, and slow.
    const trajectory = shot(0, -3, 1, -3, 1.6, 'drop');
    const slow = receiver(4.5, 9.5);
    slow.speedFactor = 0.4;
    const plan = planIntercept(trajectory, slow, 0, config)!;
    expect(plan.reachable).toBe(false);
    expect(plan.slack).toBeLessThan(0);
  });

  it('no hay plan para una pelota que ya no se puede jugar', () => {
    const trajectory = shot(0, -7, 0.9, 0, 4.5, 'lob');
    const afterTheEnd = trajectory.end!.t + 0.1;
    expect(planIntercept(trajectory, receiver(0, 7.4), afterTheEnd, config)).toBeNull();
  });

  it('con joystick, el contacto es donde la pelota pasa más cerca del jugador', () => {
    const trajectory = shot(0, -7, 0.9, 1, 6.5, 'drive');
    // Standing right where the ball comes down after the bounce.
    const bounce = trajectory.bounces[0]!;
    const near = receiver(bounce.x - 0.6, bounce.y + 1.2);
    near.manual = true;
    const contact = contactNear(trajectory, near, bounce.t, config)!;
    expect(contact).not.toBeNull();
    expect(Math.hypot(contact.x - near.x, contact.y - near.y)).toBeLessThanOrEqual(config.player.reach);

    // Too far away there is nothing to hit.
    const far = receiver(-4.5, 2);
    far.manual = true;
    expect(contactNear(trajectory, far, bounce.t, config)).toBeNull();
  });
});

describe('la IA juega con las paredes', () => {
  it('en un partido devuelve pelotas después del rebote en el vidrio', () => {
    const cfg = createConfig();
    const match = new Match({
      config: cfg,
      seed: 21,
      teams: [
        { name: 'A', players: [aiEntry(cfg, 'hard', 5)] },
        { name: 'B', players: [aiEntry(cfg, 'hard', 6)] },
      ],
    });

    // Count the hits that come after "bounce, then wall" with nothing in between.
    let sequence: string[] = [];
    let offTheWall = 0;
    let hits = 0;
    playMatch(match, 3600, (event) => {
      if (event.type === 'hit') {
        hits++;
        if (sequence.includes('bounce') && sequence[sequence.length - 1] === 'wall') offTheWall++;
        sequence = [];
      } else if (event.type === 'bounce' || event.type === 'wall') {
        sequence.push(event.type);
      } else if (event.type === 'point' || event.type === 'fault') {
        sequence = [];
      }
    });
    expect(hits).toBeGreaterThan(20);
    expect(offTheWall).toBeGreaterThan(3);
  });

  it('deja pasar la pelota que se va larga', () => {
    const cfg = createConfig();
    // A drive aimed past the back wall never bounces in: the receiver must not touch it.
    const launch = solveShot(0, -7, 0.9, 0, 10.8, cfg.shots.specs.drive, cfg.physics, cfg.court);
    const match = new Match({
      config: cfg,
      seed: 3,
      teams: [
        { name: 'A', players: [aiEntry(cfg, 'hard', 1)] },
        { name: 'B', players: [aiEntry(cfg, 'hard', 2)] },
      ],
    });
    // Put the match in the middle of a rally with that ball in the air.
    match.phase = 'rally';
    Object.assign(match.ball, { x: 0, y: -7, z: 0.9, vx: launch.vx, vy: launch.vy, vz: launch.vz });
    registerHit(match.rally, 0, false, 1);
    match.trajectory = predictTrajectory(match.ball, match.rally, match.time, cfg);
    match.assigned[1] = match.players[1]!.id;

    expect(match.shouldLeave(1)).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < 360 && !events.some((event) => event.type === 'point'); i++) {
      match.step();
      events.push(...match.events);
      match.events.length = 0;
      expect(match.players[1]!.plan).toBeNull();
    }
    expect(events.filter((event) => event.type === 'hit')).toHaveLength(0);
    expect(events.find((event) => event.type === 'point')).toMatchObject({ winner: 1, reason: 'wall' });
  });
});
