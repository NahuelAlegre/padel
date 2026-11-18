import { describe, expect, it } from 'vitest';
import { FORMATS, createConfig, type GameConfig } from '../src/config';
import { autoMove } from '../src/control/autopilot';
import { HumanController } from '../src/control/human';
import { InputState } from '../src/input/state';
import { inServiceBox } from '../src/sim/court';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { registerHit } from '../src/sim/rules';
import { solveShot } from '../src/sim/shots';
import { predictTrajectory } from '../src/sim/trajectory';
import type { PlayerIntent, ShotIntent } from '../src/sim/types';
import { aiEntry, HUMAN_REACH, playMatch } from './helpers';

const shot = (more: Partial<ShotIntent> = {}): ShotIntent => ({ aim: 0, depth: 0.8, lob: false, power: 1, ...more });

/** A player that runs to the ball by itself and swings only when the test says so. */
class Puppet implements Controller {
  decide: (match: Match, me: Player) => ShotIntent | null = () => null;

  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
    intent.swing = this.decide(match, me);
  }
}

/**
 * A player moved by hand, the way a person plays: it pushes the stick toward
 * `goTo` (by default, where the advice says to stand) and swings when the
 * test says so.
 */
class HandMoved implements Controller {
  decide: (match: Match, me: Player) => ShotIntent | null = () => null;
  goTo: (match: Match, me: Player) => { x: number; y: number } | null = (_match, me) =>
    me.guide ? { x: me.guide.stanceX, y: me.guide.stanceY } : null;

  update(match: Match, me: Player, intent: PlayerIntent): void {
    const target = this.goTo(match, me);
    if (target) {
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.15) {
        intent.moveX = dx / distance;
        intent.moveY = dy / distance;
      }
    }
    intent.swing = this.decide(match, me);
  }
}

function entry(controller: Controller, overrides: Partial<PlayerEntry> = {}): PlayerEntry {
  return {
    name: 'Test',
    isHuman: false,
    manual: false,
    speedFactor: 1,
    reaction: 0,
    errorScale: 0, // no scatter: shots land exactly where they are aimed
    reachScale: 1,
    hand: 1,
    controller,
    ...overrides,
  };
}

function setup(configure?: (config: GameConfig) => void, near: Partial<PlayerEntry> = {}, far: Partial<PlayerEntry> = {}) {
  const config = createConfig();
  configure?.(config);
  const a = new Puppet();
  const b = new Puppet();
  const match = new Match({
    config,
    seed: 7,
    teams: [
      { name: 'A', players: [entry(a, near)] },
      { name: 'B', players: [entry(b, far)] },
    ],
  });
  return { match, config, a, b, server: match.players[0]!, receiver: match.players[1]! };
}

/** Steps the match, collecting events, until `done` says so. */
function run(match: Match, done: (events: SimEvent[]) => boolean, maxSeconds = 30): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxSeconds * 120; i++) {
    match.step();
    all.push(...match.events);
    match.events.length = 0;
    if (done(all)) return all;
  }
  throw new Error(`Condition not reached in ${maxSeconds} s. Events: ${all.map((e) => e.type).join(', ')}`);
}

type Hit = Extract<SimEvent, { type: 'hit' }>;
const has = (type: SimEvent['type']) => (events: SimEvent[]) => events.some((event) => event.type === type);
const once = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.find((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const hitsOf = (events: SimEvent[]): Hit[] => events.filter((event): event is Hit => event.type === 'hit');
const serving = (match: Match): ShotIntent | null => (match.phase === 'serve' ? shot() : null);

describe('saque', () => {
  it('el que saca se para detrás de la línea de saque, a la derecha, y el que recibe en diagonal', () => {
    const { match, config, server, receiver } = setup();
    expect(match.phase).toBe('serve');
    expect(match.serverId).toBe(server.id);
    expect(server.x).toBeGreaterThan(0);
    expect(server.y).toBeLessThan(-config.court.serviceLine);
    expect(receiver.x).toBeLessThan(0);
    expect(receiver.y).toBeGreaterThan(config.court.serviceLine);
    // The server holds the ball until it swings.
    match.step();
    expect(Math.hypot(match.ball.x - server.x, match.ball.y - server.y)).toBeLessThan(0.6);
    expect(match.phase).toBe('serve');
  });

  it('pica en el cuadro cruzado', () => {
    const { match, config, a } = setup();
    a.decide = serving;
    const events = run(match, (all) => all.filter((event) => event.type === 'bounce').length >= 2);

    const hit = once(events, 'hit')!;
    expect(hit.kind).toBe('serve');
    // Hit below the waist: it is an underhand serve.
    expect(hit.z).toBeLessThan(1);

    // The first bounce is the ball being dropped; the second one is the serve landing.
    const landing = events.filter((event) => event.type === 'bounce')[1]!;
    if (landing.type !== 'bounce') throw new Error('unreachable');
    expect(inServiceBox(config.court, landing.x, landing.y, 1, -1)).toBe(true);
    expect(landing.x).toBeLessThan(0);
  });

  it('se puede apuntar dentro del cuadro', () => {
    const landingX = (aim: number): number => {
      const { match, a } = setup();
      a.decide = (m) => (m.phase === 'serve' ? shot({ aim }) : null);
      const events = run(match, (all) => all.filter((event) => event.type === 'bounce').length >= 2);
      const landing = events.filter((event) => event.type === 'bounce')[1]!;
      return landing.type === 'bounce' ? landing.x : NaN;
    };
    const left = landingX(-1);
    const right = landingX(1);
    expect(left).toBeLessThan(right - 2);
    // Both still inside the box on the left half.
    expect(right).toBeLessThan(0);
    expect(left).toBeGreaterThan(-5);
  });

  it('sin devolución es punto por doble pique, y el próximo saque es desde la izquierda', () => {
    const { match, a, server } = setup();
    a.decide = serving;
    const events = run(match, has('point'));
    expect(once(events, 'point')).toMatchObject({ winner: 0, reason: 'doubleBounce' });
    expect(match.score.points).toEqual([1, 0]);

    a.decide = () => null;
    run(match, has('serveReady'));
    expect(match.phase).toBe('serve');
    expect(server.x).toBeLessThan(0);
    expect(match.players[1]!.x).toBeGreaterThan(0);
  });

  it('dos faltas seguidas son punto para el que recibe', () => {
    // A serve aimed past the service line is always a fault.
    const { match, a } = setup((config) => {
      config.shots.specs.serve.depthNear = 8.6;
      config.shots.specs.serve.depthFar = 8.6;
    });
    a.decide = serving;
    const events = run(match, has('point'));

    const faults = events.filter((event) => event.type === 'fault');
    expect(faults).toHaveLength(2);
    expect(faults[0]).toMatchObject({ reason: 'box', attempt: 1 });
    expect(faults[1]).toMatchObject({ reason: 'box', attempt: 2 });
    expect(once(events, 'point')).toMatchObject({ winner: 1, reason: 'doubleFault' });
    expect(match.score.points).toEqual([0, 1]);
  });

  it('el que recibe no intenta jugar un saque que va a ser falta', () => {
    const { match, a, receiver } = setup((config) => {
      config.shots.specs.serve.depthNear = 8.6;
      config.shots.specs.serve.depthFar = 8.6;
    });
    a.decide = serving;
    let planned = false;
    run(match, (all) => {
      if (receiver.plan) planned = true;
      return all.some((event) => event.type === 'fault');
    });
    expect(planned).toBe(false);
  });

  it('el saque no se volea: el plan del que recibe es después del pique', () => {
    const { match, a, receiver } = setup();
    a.decide = serving;
    run(match, () => receiver.plan !== null);
    expect(receiver.plan!.kind).not.toBe('volley');
    expect(receiver.plan!.reachable).toBe(true);
  });

  it('después del saque, el que sacó sube a la red', () => {
    const { match, a, server } = setup();
    a.decide = serving;
    run(match, has('hit'));
    expect(server.homeMode).toBe('net');
  });
});

describe('timing del golpe', () => {
  /** Serves, then makes the receiver swing `offset` seconds away from the ideal contact. */
  function returnWith(offset: number, receiverSetup: Partial<PlayerEntry> = {}) {
    const game = setup(undefined, {}, receiverSetup);
    const { match, a, b } = game;
    a.decide = serving;
    let swung = false;
    b.decide = (m, me) => {
      if (swung || !me.plan || m.time < me.plan.t + offset - 1e-9) return null;
      swung = true;
      return shot();
    };
    const events = run(match, (all) => hitsOf(all).length >= 2 || all.some((event) => event.type === 'point'));
    return { ...game, events, returned: hitsOf(events)[1] };
  }

  it('en el momento justo es perfecto', () => {
    const { returned } = returnWith(0);
    expect(returned?.quality).toBe('perfect');
    expect(returned?.team).toBe(1);
  });

  it('un poco antes es bueno, y la pelota igual se golpea cuando llega', () => {
    const { returned } = returnWith(-0.12);
    expect(returned?.quality).toBe('good');
    expect(returned?.error).toBeCloseTo(-0.12, 2);
  });

  it('muy antes dice "temprano", pero el golpe queda armado y sale tan bien como uno bueno', () => {
    const good = returnWith(-0.12).returned!;
    const early = returnWith(-0.5).returned!;
    expect(early.quality).toBe('early');
    expect(early.error).toBeCloseTo(-0.5, 2);
    expect(early.speed).toBeCloseTo(good.speed, 1);
    // Only a perfect one is better, and what it adds depends on the shot: see tests/depth.test.ts.
    expect(returnWith(0).returned!.quality).toBe('perfect');
  });

  it('después de tiempo es tarde: sale, pero más débil', () => {
    const good = returnWith(-0.12).returned!;
    const { returned } = returnWith(0.19);
    expect(returned?.quality).toBe('late');
    expect(returned?.error).toBeCloseTo(0.19, 2);
    expect(returned!.speed).toBeLessThan(good.speed);
  });

  it('sin golpe, la pelota pica dos veces y es punto del rival', () => {
    const { returned, events } = returnWith(Infinity);
    expect(returned).toBeUndefined();
    expect(once(events, 'point')).toMatchObject({ winner: 0, reason: 'doubleBounce' });
  });

  it('a una persona se le descuenta la latencia de la pantalla y del toque', () => {
    const latency = createConfig().timing.latencyCompensation;
    const { returned } = returnWith(latency, { isHuman: true });
    expect(returned?.quality).toBe('perfect');
    expect(returned?.error).toBeCloseTo(0, 2);
  });

  it('un golpe al aire no rompe nada', () => {
    const { match, a, b } = setup();
    a.decide = serving;
    // The server swings again right after serving: the ball is not his to hit.
    const events = run(match, has('hit'));
    a.decide = () => shot();
    b.decide = () => null;
    const more = run(match, has('whiff'));
    expect(once(more, 'whiff')).toMatchObject({ player: 0, reason: 'nothing' });
    expect(hitsOf(events)).toHaveLength(1);
  });

  it('pedir otro golpe antes de que llegue la pelota reemplaza al que estaba armado', () => {
    const { match, a, b } = setup();
    a.decide = serving;
    let asked = 0;
    b.decide = (m, me) => {
      if (!me.plan) return null;
      // First well to the right, then, a moment later, well to the left.
      if (asked === 0 && m.time < me.plan.t - 0.6) return (asked = 1), shot({ aim: 1 });
      if (asked === 1 && m.time >= me.plan.t - 0.3) return (asked = 2), shot({ aim: -1 });
      return null;
    };
    const events = run(match, (all) => all.filter((event) => event.type === 'bounce').length >= 4 || has('point')(all));
    expect(asked).toBe(2);
    expect(hitsOf(events)).toHaveLength(2);
    // The return went left: the last request is the one that counted.
    const bounces = events.filter((event) => event.type === 'bounce');
    const landing = bounces[bounces.length - 1]!;
    expect(landing.type === 'bounce' && landing.x).toBeLessThan(-2);
  });
});

describe('movimiento asistido (opción de accesibilidad)', () => {
  /**
   * The serve bounces and carries on to the back glass, and the assisted plan
   * is to wait for the rebound. The person swings as the ball goes by instead.
   */
  function swingAtPassingBall(configure?: (config: GameConfig) => void) {
    const { match, a, b, receiver } = setup(configure, {}, { isHuman: true });
    a.decide = serving;
    const result = { swungAt: -1, plannedFor: -1, returnedAt: -1, wallFirst: false };
    b.decide = (m, me) => {
      if (result.swungAt >= 0 || !me.plan || m.rally.bounces !== 1) return null;
      const gap = Math.hypot(m.ball.x - me.x, m.ball.y - me.y);
      if (gap > 1 || me.plan.t - m.time < 0.25) return null;
      result.swungAt = m.time;
      result.plannedFor = me.plan.t;
      return shot();
    };
    for (let i = 0; i < 120 * 8 && result.returnedAt < 0; i++) {
      match.step();
      for (const event of match.events) {
        if (event.type === 'wall' && result.swungAt >= 0) result.wallFirst = true;
        if (event.type === 'hit' && event.team === receiver.team) result.returnedAt = match.time;
        if (event.type === 'point') i = Infinity;
      }
      match.events.length = 0;
    }
    return result;
  }

  it('si la persona pega cuando la pelota le pasa al lado, le pega ahí en vez de esperar la pared', () => {
    const { swungAt, plannedFor, returnedAt, wallFirst } = swingAtPassingBall();
    expect(swungAt).toBeGreaterThan(0);
    expect(returnedAt).toBeGreaterThan(0);
    // Hit right away, before the wall and well before the contact that was planned.
    expect(returnedAt - swungAt).toBeLessThan(0.2);
    expect(returnedAt).toBeLessThan(plannedFor - 0.1);
    expect(wallFirst).toBe(false);
  });

  it('sin esa regla, el mismo golpe espera la pared', () => {
    const { swungAt, plannedFor, returnedAt, wallFirst } = swingAtPassingBall((config) => {
      config.timing.takeNow = -1;
      config.timing.takeNowBack = -1;
    });
    expect(swungAt).toBeGreaterThan(0);
    expect(returnedAt).toBeCloseTo(plannedFor, 1);
    expect(wallFirst).toBe(true);
  });
});

describe('movimiento a mano (el modo por defecto)', () => {
  /** A person on the near half, moved by hand, receiving the serve of a puppet. */
  function handGame(more: Partial<PlayerEntry> = {}) {
    const config = createConfig();
    const me = new HandMoved();
    const rival = new Puppet();
    rival.decide = serving;
    const match = new Match({
      config,
      seed: 4,
      firstServer: 1,
      teams: [
        { name: 'A', players: [entry(me, { isHuman: true, manual: true, reachScale: HUMAN_REACH, ...more })] },
        { name: 'B', players: [entry(rival)] },
      ],
    });
    return { match, config, me, rival, player: match.players[0]! };
  }

  it('el jugador no se mueve solo: sin joystick se queda donde está', () => {
    const { match, me, player } = handGame();
    me.goTo = () => null;
    run(match, has('hit'));
    const start = { x: player.x, y: player.y };
    for (let i = 0; i < 90; i++) match.step();
    expect(player.x).toBeCloseTo(start.x, 6);
    expect(player.y).toBeCloseTo(start.y, 6);
    // It is told where it would be good to stand, but that is only advice.
    expect(player.guide).not.toBeNull();
  });

  it('se puede elegir a dónde pegar antes de que llegue la pelota: el golpe queda armado', () => {
    const { match, me, player } = handGame();
    let armedAt = -1;
    me.decide = (m) => {
      // Ask for the shot as soon as the serve is in the air, long before it can be reached.
      if (armedAt >= 0 || !m.rally.live || m.rally.hitter !== 1) return null;
      armedAt = m.time;
      return shot({ aim: 1, depth: 1 });
    };
    let armedWhileFar = false;
    const events = run(match, (all) => {
      if (player.swing && !player.plan) armedWhileFar = true;
      return hitsOf(all).length >= 2 || has('point')(all);
    });
    const mine = hitsOf(events)[1];
    expect(armedWhileFar).toBe(true);
    expect(mine?.team).toBe(0);
    // It was hit when the ball arrived, a good while after the request...
    expect(match.time - armedAt).toBeGreaterThan(0.5);
    // ...as an early one, which is never a perfect.
    expect(mine?.quality).toBe('early');
  });

  it('va a donde se apuntó', () => {
    const { match, me } = handGame();
    me.decide = (m) => (m.rally.live && m.rally.hitter === 1 && m.rallyHits === 1 ? shot({ aim: 1, depth: 1 }) : null);
    const events = run(match, (all) => hitsOf(all).length >= 2 && all[all.length - 1]!.type === 'bounce');
    const landing = events[events.length - 1]!;
    if (landing.type !== 'bounce') throw new Error('unreachable');
    expect(landing.y).toBeGreaterThan(5);
    expect(landing.x).toBeGreaterThan(2);
  });

  it('soltar justo cuando llega la pelota es perfecto', () => {
    const { match, me, player, config } = handGame();
    let done = false;
    me.decide = (m) => {
      const contact = player.plan;
      if (done || !contact || m.time < contact.t + config.timing.latencyCompensation - 1e-9) return null;
      done = true;
      return shot();
    };
    const events = run(match, (all) => hitsOf(all).length >= 2 || has('point')(all));
    expect(hitsOf(events)[1]?.quality).toBe('perfect');
  });

  it('si el jugador no llega, el golpe sigue armado y no hay golpe al aire', () => {
    const { match, me, player } = handGame();
    me.goTo = () => null; // never moves
    me.decide = (m) => (m.rally.live && m.rally.hitter === 1 && m.rallyHits === 1 ? shot() : null);
    // Park it in the far corner, well away from the serve.
    run(match, has('hit'));
    player.x = 4.4;
    player.y = -1;
    const events = run(match, has('point'));
    expect(hitsOf(events)).toHaveLength(0);
    expect(events.some((event) => event.type === 'whiff')).toBe(false);
    expect(once(events, 'point')).toMatchObject({ winner: 1 });
    // The armed swing died with the point.
    expect(player.swing).toBeNull();
  });

  it('acercarse alcanza: la persona llega a pelotas que pasan a más de un metro', () => {
    // A ball that has bounced flies straight past, a metre and a half to the
    // side of a player who is standing still with the shot armed.
    const reaches = (reachScale: number): boolean => {
      const { match, config, me, player } = handGame({ reachScale });
      me.goTo = () => null;
      run(match, has('serveReady'));
      match.phase = 'rally';
      player.x = 0;
      player.y = -6;
      Object.assign(match.ball, { x: 1.5, y: -2, z: 1, vx: 0, vy: -8, vz: 2, rolling: false });
      registerHit(match.rally, 1, false, 1);
      match.rally.bounces = 1;
      match.trajectory = predictTrajectory(match.ball, match.rally, match.time, config);
      match.events.length = 0;
      me.decide = (m) => (m.rally.hitter === 1 && !player.swing ? shot() : null);
      const events = run(match, (all) => hitsOf(all).length >= 1 || has('point')(all));
      return hitsOf(events).length >= 1;
    };
    const base = createConfig().player.reach;
    expect(base * HUMAN_REACH).toBeGreaterThan(1.5);
    expect(base).toBeLessThan(1.5);
    expect(reaches(HUMAN_REACH)).toBe(true);
    expect(reaches(1)).toBe(false);
  });

  it('con el golpe armado, a la pelota profunda la deja ir al vidrio y le pega a la salida', () => {
    const { match, config, me, player } = handGame();
    me.goTo = () => null;
    run(match, has('serveReady'));
    match.phase = 'rally';
    player.x = 0.3;
    player.y = -7.6;
    // A deep drive: it lands a metre behind the player and comes back off the glass.
    const launch = solveShot(0, 7, 0.9, 1, -8.6, config.shots.specs.drive, config.physics, config.court);
    Object.assign(match.ball, { x: 0, y: 7, z: 0.9, vx: launch.vx, vy: launch.vy, vz: launch.vz, rolling: false });
    registerHit(match.rally, 1, false, 1);
    match.trajectory = predictTrajectory(match.ball, match.rally, match.time, config);
    match.events.length = 0;

    // The thumb lets go while the ball is still on the other side: the shot is armed.
    me.decide = (m) => (m.rally.hitter === 1 && !player.swing ? shot() : null);
    const events = run(match, (all) => hitsOf(all).length >= 1 || has('point')(all));
    const hit = hitsOf(events)[0];
    // Not in the air at shin height as it went by, and not into the own glass
    // once it was past: after the bounce and the glass, the comfortable ball.
    expect(hit?.kind).toBe('wallExit');
    const before = events.slice(0, events.indexOf(hit!));
    expect(before.filter((event) => event.type === 'bounce')).toHaveLength(1);
    expect(before.some((event) => event.type === 'wall')).toBe(true);
    expect(hit!.z).toBeGreaterThan(0.5);
  });

  it('una pelota que ya pasó al jugador cerca del fondo se devuelve de contrapared', () => {
    const { match, config, me, player } = handGame();
    me.goTo = () => null;
    // Put the match in the middle of a rally: the ball has bounced on the
    // person's half and is drifting toward the back glass, behind the player.
    run(match, has('serveReady'));
    match.phase = 'rally';
    player.x = 0;
    player.y = -8.5;
    Object.assign(match.ball, { x: 0.5, y: -9.1, z: 0.7, vx: 0, vy: -0.6, vz: 1.2, rolling: false });
    registerHit(match.rally, 1, false, 1);
    match.rally.bounces = 1;
    match.trajectory = predictTrajectory(match.ball, match.rally, match.time, config);
    match.events.length = 0;

    me.decide = (m) => (m.rally.hitter === 1 ? shot({ aim: 0 }) : null);
    const events = run(match, (all) => hitsOf(all).length >= 1 && all.filter((e) => e.type === 'bounce').length >= 1);
    const hit = hitsOf(events)[0]!;
    expect(hit.kind).toBe('backWall');
    // Into the own glass first, then over the net and down on the rival's half.
    const afterHit = events.slice(events.indexOf(hit) + 1);
    expect(afterHit.find((event) => event.type === 'wall')).toMatchObject({ wall: 'backNear', surface: 'glass' });
    const landing = afterHit.find((event) => event.type === 'bounce')!;
    expect(landing.type === 'bounce' && landing.y).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'point')).toBe(false);
  });
});

describe('entre punto y punto', () => {
  it('la pausa dura un segundo como mucho', () => {
    const { rules } = createConfig();
    expect(rules.pointPause).toBeLessThanOrEqual(1);
    expect(rules.gamePause).toBeLessThanOrEqual(1);
    expect(rules.faultPause).toBeLessThanOrEqual(1);
  });

  it('se puede saltar con un toque, pero no en el mismo instante en que terminó el punto', () => {
    const { match, config, a } = setup();
    a.decide = serving;
    run(match, has('point'));
    a.decide = () => null;
    expect(match.phase).toBe('pointOver');
    expect(match.skipPause()).toBe(false);

    const steps = Math.ceil(config.rules.skipAfter * 120) + 1;
    for (let i = 0; i < steps; i++) match.step();
    expect(match.phase).toBe('pointOver');
    expect(match.skipPause()).toBe(true);
    match.events.length = 0;
    match.step();
    expect(match.phase).toBe('serve');
    expect(match.events.some((event) => event.type === 'serveReady')).toBe(true);
    // Nothing to skip while the ball is in play.
    expect(match.skipPause()).toBe(false);
  });
});

describe('guardar y seguir', () => {
  it('un partido se retoma en el mismo punto: marcador, saque y lado', () => {
    const config = createConfig();
    config.rules.format = { ...FORMATS.match };
    const play = (seed: number) =>
      new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [aiEntry(config, 'medium', 1)] },
          { name: 'B', players: [aiEntry(config, 'medium', 2)] },
        ],
      });
    const first = play(9);
    // Play until some point in the second game.
    run(first, () => first.score.games[0] + first.score.games[1] === 1 && first.score.points[0] + first.score.points[1] === 2 && first.phase === 'serve', 600);
    const saved = JSON.parse(JSON.stringify(first.snapshot())) as ReturnType<Match['snapshot']>;

    const second = new Match({
      config,
      seed: 123,
      teams: [
        { name: 'A', players: [aiEntry(config, 'medium', 3)] },
        { name: 'B', players: [aiEntry(config, 'medium', 4)] },
      ],
      resume: saved,
    });
    expect(second.score).toEqual(first.score);
    expect(second.serverId).toBe(first.serverId);
    expect(second.serveAttempt).toBe(first.serveAttempt);
    expect(second.players[0]!.x).toBeCloseTo(first.players[0]!.x, 6);
    expect(second.players[1]!.x).toBeCloseTo(first.players[1]!.x, 6);
    // And it can be played to the end from there.
    const summary = playMatch(second);
    expect(summary.winner).toBeGreaterThanOrEqual(0);
    // Changing the copy did not touch the original.
    expect(first.score.games[0] + first.score.games[1]).toBe(1);
  });
});

describe('el primer peloteo es el tutorial', () => {
  function tutorialMatch() {
    const config = createConfig();
    const me = new Puppet();
    const match = new Match({
      config,
      seed: 11,
      tutorial: true,
      teams: [
        { name: 'Vos', players: [entry(me, { isHuman: true, errorScale: 1 })] },
        { name: 'Rival', players: [aiEntry(config, 'easy', 5)] },
      ],
    });
    return { match, me };
  }

  it('el rival devuelve una pelota lenta y deja pasar la siguiente: el primer punto se puede ganar', () => {
    const { match, me } = tutorialMatch();
    // The person serves and then hits everything on time.
    me.decide = (m, player) => {
      if (m.phase === 'serve') return shot();
      return player.plan && !player.swing && m.time >= player.plan.t - 0.05 ? shot() : null;
    };
    expect(match.tutorial).toBe(true);
    const events = run(match, has('point'), 60);
    const hits = hitsOf(events);
    // Serve, a gentle return, the person's shot, and nothing else.
    expect(hits.map((hit) => hit.team)).toEqual([0, 1, 0]);
    expect(hits[1]!.speed).toBeLessThan(13);
    expect(once(events, 'point')).toMatchObject({ winner: 0 });
    // Having won a point, the person is on their own.
    expect(match.tutorial).toBe(false);
  });

  it('si el punto se pierde, el rival sigue siendo amable', () => {
    const { match, me } = tutorialMatch();
    me.decide = (m) => (m.phase === 'serve' ? shot() : null); // serves and then does nothing
    run(match, has('point'), 60);
    expect(match.score.points).toEqual([0, 1]);
    expect(match.tutorial).toBe(true);
  });
});

describe('partido completo', () => {
  function aiMatch(seed: number, doubles = false, configure?: (config: GameConfig) => void) {
    const config = createConfig();
    configure?.(config);
    const team = (base: number) =>
      doubles
        ? [aiEntry(config, 'medium', base), aiEntry(config, 'medium', base + 1)]
        : [aiEntry(config, 'medium', base)];
    return new Match({
      config,
      seed,
      teams: [
        { name: 'A', players: team(seed * 3) },
        { name: 'B', players: team(seed * 3 + 10) },
      ],
    });
  }

  it('dos IA terminan un partido', () => {
    const match = aiMatch(11);
    const summary = playMatch(match);
    expect(summary.stalled).toBe(false);
    expect(summary.winner).toBeGreaterThanOrEqual(0);
    expect(match.score.winner).toBe(summary.winner);
    expect(match.score.games[summary.winner as 0 | 1]).toBe(match.format.gamesToWin);
    expect(summary.pointsWon[0] + summary.pointsWon[1]).toBe(summary.points);
    expect(summary.hits).toBeGreaterThan(summary.points);
  });

  it('con la misma semilla el partido es idéntico', () => {
    const record = (seed: number): string[] => {
      const log: string[] = [];
      playMatch(aiMatch(seed), 3600, (event) => {
        if (event.type === 'hit') log.push(`${event.player}:${event.kind}:${event.x.toFixed(4)}:${event.speed.toFixed(4)}`);
        else if (event.type === 'point') log.push(`point:${event.winner}:${event.reason}`);
      });
      return log;
    };
    expect(record(5)).toEqual(record(5));
    expect(record(5)).not.toEqual(record(6));
  });

  it('los golpes salen con su nombre según la situación', () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3]) {
      playMatch(aiMatch(seed), 3600, (event) => {
        if (event.type === 'hit') kinds.add(event.kind);
      });
    }
    // In a few matches every family of shot shows up.
    for (const kind of ['serve', 'drive', 'volley', 'lob', 'wallExit']) expect(kinds.has(kind)).toBe(true);
    expect(kinds.has('smash') || kinds.has('bandeja') || kinds.has('vibora')).toBe(true);
  });

  it('el set a 4 juegos se define por tie-break cuando llega a 3 iguales', () => {
    // Look for a match that gets to 3-3; they are not rare.
    for (let seed = 1; seed <= 40; seed++) {
      const match = aiMatch(seed, false, (config) => (config.rules.format = { ...FORMATS.match }));
      let tieBreaks = 0;
      const summary = playMatch(match, 3600, (event) => {
        if (event.type === 'tieBreak') tieBreaks++;
      });
      expect(summary.stalled).toBe(false);
      const games = match.score.games;
      expect(Math.max(games[0], games[1])).toBe(4);
      if (tieBreaks === 0) {
        expect(Math.min(games[0], games[1])).toBeLessThan(3);
        continue;
      }
      expect(tieBreaks).toBe(1);
      expect(Math.min(games[0], games[1])).toBe(3);
      return;
    }
    throw new Error('No match reached a tie-break');
  });

  it('funciona con dos jugadores por equipo y el saque rota entre los cuatro', () => {
    const match = aiMatch(3, true);
    expect(match.players).toHaveLength(4);
    expect(match.teamSizes).toEqual([2, 2]);

    const servers: number[] = [];
    let games = 0;
    let record = true;
    const summary = playMatch(match, 3600, (event) => {
      if (event.type === 'serveReady' && record) {
        servers.push(event.server);
        record = false;
      } else if (event.type === 'game') {
        games++;
        record = true;
      }
    });
    expect(summary.stalled).toBe(false);
    expect(summary.winner).toBeGreaterThanOrEqual(0);
    // Players 0 and 1 are team A, 2 and 3 team B: the serve alternates teams.
    expect(servers[0]).toBe(0);
    expect(servers[1]).toBe(2);
    if (servers.length > 2) expect(servers[2]).toBe(1);
    expect(games).toBeGreaterThanOrEqual(match.format.gamesToWin);
  });
});

describe('interpolación y entrada', () => {
  it('guarda la posición del paso anterior para interpolar', () => {
    const { match, a, receiver } = setup();
    a.decide = serving;
    run(match, () => receiver.plan !== null && Math.hypot(receiver.vx, receiver.vy) > 1);
    const before = { x: receiver.x, y: receiver.y, ball: { ...match.ball } };
    match.step();
    expect(receiver.px).toBe(before.x);
    expect(receiver.py).toBe(before.y);
    expect(match.ballPrev.x).toBe(before.ball.x);
    expect(match.ballPrev.z).toBe(before.ball.z);
    expect(Math.hypot(receiver.x - receiver.px, receiver.y - receiver.py)).toBeGreaterThan(0);
  });

  it('el joystick mueve al jugador: arriba es hacia la red', () => {
    const config = createConfig();
    const input = new InputState();
    const server = new Puppet();
    server.decide = serving;
    const match = new Match({
      config,
      seed: 2,
      firstServer: 1,
      teams: [
        { name: 'A', players: [entry(new HumanController(input), { isHuman: true, manual: true })] },
        { name: 'B', players: [entry(server)] },
      ],
    });
    const me = match.players[0]!;
    run(match, has('hit'));

    const start = { x: me.x, y: me.y };
    input.setMove('stick', 1, 1);
    for (let i = 0; i < 30; i++) match.step();
    expect(me.x).toBeGreaterThan(start.x + 0.3);
    expect(me.y).toBeGreaterThan(start.y + 0.3);

    // Let go: it stops, and stays there.
    input.setMove('stick', 0, 0);
    for (let i = 0; i < 40; i++) match.step();
    const stopped = { x: me.x, y: me.y };
    for (let i = 0; i < 30; i++) match.step();
    expect(me.x).toBeCloseTo(stopped.x, 6);
    expect(me.y).toBeCloseTo(stopped.y, 6);
  });
});
