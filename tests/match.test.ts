import { describe, expect, it } from 'vitest';
import { createConfig, type GameConfig } from '../src/config';
import { autoMove } from '../src/control/autopilot';
import { HumanController } from '../src/control/human';
import { InputState } from '../src/input/state';
import { inServiceBox } from '../src/sim/court';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { PlayerIntent, ShotIntent } from '../src/sim/types';
import { aiEntry, playMatch } from './helpers';

/** A player that runs to the ball by itself and swings only when the test says so. */
class Puppet implements Controller {
  decide: (match: Match, me: Player) => ShotIntent | null = () => null;

  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
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

const has = (type: SimEvent['type']) => (events: SimEvent[]) => events.some((event) => event.type === type);
const once = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.find((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const serveNow = (): ShotIntent => ({ kind: 'safe', aim: 0 });

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
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    const events = run(match, (all) => all.filter((event) => event.type === 'bounce').length >= 2);

    const hit = once(events, 'hit')!;
    expect(hit.kind).toBe('serve');
    // Hit below the waist: it is an underhand serve.
    expect(hit.z).toBeLessThan(1);

    // The first bounce is the ball being dropped; the second one is the serve landing.
    const bounces = events.filter((event) => event.type === 'bounce');
    const landing = bounces[1]!;
    if (landing.type !== 'bounce') throw new Error('unreachable');
    expect(inServiceBox(config.court, landing.x, landing.y, 1, -1)).toBe(true);
    expect(landing.x).toBeLessThan(0);
  });

  it('sin devolución es punto por doble pique, y el próximo saque es desde la izquierda', () => {
    const { match, a, server } = setup();
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    const events = run(match, has('point'));
    expect(once(events, 'point')).toMatchObject({ winner: 0, reason: 'doubleBounce' });
    expect(match.score.points).toEqual([1, 0]);

    a.decide = () => null;
    run(match, (all) => all.some((event) => event.type === 'serveReady'));
    expect(match.phase).toBe('serve');
    expect(server.x).toBeLessThan(0);
    expect(match.players[1]!.x).toBeGreaterThan(0);
  });

  it('dos faltas seguidas son punto para el que recibe', () => {
    // A serve aimed past the service line is always a fault.
    const { match, a } = setup((config) => (config.shots.specs.serve.depth = 8.6));
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    const events = run(match, has('point'));

    const faults = events.filter((event) => event.type === 'fault');
    expect(faults).toHaveLength(2);
    expect(faults[0]).toMatchObject({ reason: 'box', attempt: 1 });
    expect(faults[1]).toMatchObject({ reason: 'box', attempt: 2 });
    expect(once(events, 'point')).toMatchObject({ winner: 1, reason: 'doubleFault' });
    expect(match.score.points).toEqual([0, 1]);
  });

  it('el que recibe no intenta jugar un saque que va a ser falta', () => {
    const { match, a, receiver } = setup((config) => (config.shots.specs.serve.depth = 8.6));
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    let planned = false;
    run(match, (all) => {
      if (receiver.plan) planned = true;
      return all.some((event) => event.type === 'fault');
    });
    expect(planned).toBe(false);
  });

  it('el saque no se volea: el plan del que recibe es después del pique', () => {
    const { match, a, receiver } = setup();
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    run(match, () => receiver.plan !== null);
    expect(receiver.plan!.kind).not.toBe('volley');
    expect(receiver.plan!.reachable).toBe(true);
  });

  it('después del saque, el que sacó sube a la red', () => {
    const { match, a, server } = setup();
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    run(match, has('hit'));
    expect(server.homeMode).toBe('net');
  });
});

describe('timing del golpe', () => {
  /** Serves, then makes the receiver swing `offset` seconds away from the ideal contact. */
  function returnWith(offset: number, receiverSetup: Partial<PlayerEntry> = {}) {
    const game = setup(undefined, {}, receiverSetup);
    const { match, a, b } = game;
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    let swung = false;
    b.decide = (m, me) => {
      if (swung || !me.plan || m.time < me.plan.t + offset - 1e-9) return null;
      swung = true;
      return { kind: 'drive', aim: 0 };
    };
    const events = run(match, (all) => all.filter((event) => event.type === 'hit').length >= 2 || all.some((event) => event.type === 'point'));
    const hits = events.filter((event) => event.type === 'hit');
    return { ...game, events, returned: hits[1] as Extract<SimEvent, { type: 'hit' }> | undefined };
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

  it('muy antes es temprano: el golpe sale, pero flojo', () => {
    const perfect = returnWith(0).returned!;
    const early = returnWith(-0.35).returned!;
    expect(early.quality).toBe('early');
    expect(early.speed).toBeLessThan(perfect.speed);
  });

  it('un poco después es tarde', () => {
    const { returned } = returnWith(0.19);
    expect(returned?.quality).toBe('late');
    expect(returned?.error).toBeCloseTo(0.19, 2);
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

  /**
   * The serve bounces and carries on to the back glass, and the assisted plan
   * is to wait for the rebound. The person swipes as the ball goes by instead.
   */
  function swipeAtPassingBall(configure?: (config: GameConfig) => void) {
    const { match, a, b, receiver } = setup(configure, {}, { isHuman: true });
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    const result = { swungAt: -1, plannedFor: -1, returnedAt: -1, wallFirst: false, quality: '' };
    b.decide = (m, me) => {
      if (result.swungAt >= 0 || !me.plan || m.rally.bounces !== 1) return null;
      const gap = Math.hypot(m.ball.x - me.x, m.ball.y - me.y);
      if (gap > 1 || me.plan.t - m.time < 0.25) return null;
      result.swungAt = m.time;
      result.plannedFor = me.plan.t;
      return { kind: 'drive', aim: 0 };
    };
    for (let i = 0; i < 120 * 8 && result.returnedAt < 0; i++) {
      match.step();
      for (const event of match.events) {
        if (event.type === 'wall' && result.swungAt >= 0) result.wallFirst = true;
        if (event.type === 'hit' && event.team === receiver.team) {
          result.returnedAt = match.time;
          result.quality = event.quality;
        }
        if (event.type === 'point') i = Infinity;
      }
      match.events.length = 0;
    }
    return result;
  }

  it('si la persona desliza cuando la pelota le pasa al lado, le pega ahí en vez de esperar la pared', () => {
    const { swungAt, plannedFor, returnedAt, wallFirst, quality } = swipeAtPassingBall();
    expect(swungAt).toBeGreaterThan(0);
    expect(returnedAt).toBeGreaterThan(0);
    // Hit right away, before the wall and well before the contact that was planned.
    expect(returnedAt - swungAt).toBeLessThan(0.2);
    expect(returnedAt).toBeLessThan(plannedFor - 0.1);
    expect(wallFirst).toBe(false);
    expect(quality).not.toBe('early');
  });

  it('sin esa regla, el mismo deslizamiento espera la pared y cuenta como temprano', () => {
    const { swungAt, plannedFor, returnedAt, wallFirst, quality } = swipeAtPassingBall((config) => {
      config.timing.takeNow = -1;
      config.timing.takeNowBack = -1;
    });
    expect(swungAt).toBeGreaterThan(0);
    expect(returnedAt).toBeCloseTo(plannedFor, 1);
    expect(wallFirst).toBe(true);
    expect(quality).toBe('early');
  });

  it('un golpe al aire no rompe nada', () => {
    const { match, a, b } = setup();
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    // The server swings again right after serving: the ball is not his to hit.
    const events = run(match, has('hit'));
    a.decide = () => ({ kind: 'drive', aim: 0 });
    b.decide = () => null;
    const more = run(match, has('whiff'));
    expect(once(more, 'whiff')).toMatchObject({ player: 0, reason: 'nothing' });
    expect(events.filter((event) => event.type === 'hit')).toHaveLength(1);
  });
});

describe('partido completo', () => {
  function aiMatch(seed: number, doubles = false) {
    const config = createConfig();
    const team = (base: number) =>
      doubles
        ? [aiEntry(config, 'normal', base), aiEntry(config, 'normal', base + 1)]
        : [aiEntry(config, 'normal', base)];
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

describe('interpolación y control manual', () => {
  it('guarda la posición del paso anterior para interpolar', () => {
    const { match, a, receiver } = setup();
    a.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
    run(match, () => receiver.plan !== null && Math.hypot(receiver.vx, receiver.vy) > 1);
    const before = { x: receiver.x, y: receiver.y, ball: { ...match.ball } };
    match.step();
    expect(receiver.px).toBe(before.x);
    expect(receiver.py).toBe(before.y);
    expect(match.ballPrev.x).toBe(before.ball.x);
    expect(match.ballPrev.z).toBe(before.ball.z);
    expect(Math.hypot(receiver.x - receiver.px, receiver.y - receiver.py)).toBeGreaterThan(0);
  });

  it('en modo manual el jugador solo se mueve con el joystick', () => {
    const config = createConfig();
    const input = new InputState();
    const server = new Puppet();
    server.decide = (m) => (m.phase === 'serve' ? serveNow() : null);
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

    // Hands off: it stays where it was, even with the ball coming.
    const start = { x: me.x, y: me.y };
    for (let i = 0; i < 30; i++) match.step();
    expect(me.x).toBeCloseTo(start.x, 6);
    expect(me.y).toBeCloseTo(start.y, 6);

    // Stick to the right and up the screen: +x and toward the net.
    input.setMove('stick', 1, 1);
    for (let i = 0; i < 30; i++) match.step();
    expect(me.x).toBeGreaterThan(start.x + 0.3);
    expect(me.y).toBeGreaterThan(start.y + 0.3);
  });
});
