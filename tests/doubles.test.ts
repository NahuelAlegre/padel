import { describe, expect, it } from 'vitest';
import { asPartner } from '../src/characters/style';
import { createConfig, type GameConfig } from '../src/config';
import { createBall, type BallState } from '../src/sim/ball';
import { contactNear, planIntercept } from '../src/sim/intercept';
import { Match, type Controller, type PlayerEntry } from '../src/sim/match';
import { BACK_LINE, createPairState, followPerson, NET_LINE, pairSpot } from '../src/sim/pair';
import { createPlayer, lowestContact, playerReach, type Player } from '../src/sim/player';
import { createRally, registerHit } from '../src/sim/rules';
import { solveShot } from '../src/sim/shots';
import { predictTrajectory } from '../src/sim/trajectory';
import { aiEntry, humanEntry, partnerEntry, playMatch, SKILLS, withTactics } from './helpers';

/** A player that does nothing at all: it stays where it is put. */
const idle: Controller = { update() {} };

function person(overrides: Partial<PlayerEntry> = {}): PlayerEntry {
  return {
    name: 'Vos',
    isHuman: true,
    manual: true,
    speedFactor: 1,
    reaction: 0,
    errorScale: 1,
    reachScale: 1,
    hand: 1,
    controller: idle,
    ...overrides,
  };
}

/**
 * A practice court with a pair on each side: the person and a computer
 * partner near the camera, two computer players on the far side. Ids go in
 * order: the near pair is 0 and 1 (0 plays the right), the far one 2 and 3.
 */
function practice(side: 'drive' | 'reves', me: PlayerEntry = person(), config = createConfig()): Match {
  const mate = partnerEntry(config, 'medium', 3, 'Compañero');
  return new Match({
    config,
    seed: 7,
    practice: true,
    teams: [
      { name: 'A', players: side === 'drive' ? [me, mate] : [mate, me] },
      { name: 'B', players: [{ ...aiEntry(config, 'medium', 5), controller: idle }, { ...aiEntry(config, 'medium', 6), controller: idle }] },
    ],
  });
}

const BACK = 7.4;
/** The near pair at the back, the far one ready to feed from the middle of its half. */
function places(near: Array<{ x: number; y: number }> = [{ x: 2.3, y: -BACK }, { x: -2.3, y: -BACK }]) {
  return [...near, { x: 0, y: 7 }, { x: 2.5, y: 7.4 }];
}

/** A comfortable ball from the far side that lands at (x, y) on the near half. */
function feedTo(match: Match, x: number, y: number): void {
  match.feed({ targetX: x, targetY: y, kind: 'drive', params: { clearance: 0.9, apex: 0, speed: 14 } });
}

describe('dobles: cada pelota tiene dueño', () => {
  it('la de tu lado es tuya, la del lado de tu compañero es suya', () => {
    const match = practice('drive');
    match.rest(places(), 2, true);
    feedTo(match, 3.4, -6.5);
    expect(match.assigned[0]).toBe(0);
    expect(match.pairs[0].why).toBe('side');

    match.rest(places(), 2, true);
    feedTo(match, -3.4, -6.5);
    expect(match.assigned[0]).toBe(1);
    expect(match.pairs[0].why).toBe('side');
  });

  it('la del medio es de quien tiene la derecha hacia el medio: el de revés, si los dos son diestros', () => {
    // You on the drive side: the middle is your partner's.
    const drive = practice('drive');
    drive.rest(places(), 2, true);
    feedTo(drive, 0.1, -6.5);
    expect(drive.pairs[0].why).toBe('middle');
    expect(drive.players[drive.assigned[0]]!.isHuman).toBe(false);

    // You on the revés side: the middle is yours, on your forehand.
    const reves = practice('reves');
    reves.rest(places(), 2, true);
    feedTo(reves, 0.1, -6.5);
    expect(reves.pairs[0].why).toBe('middle');
    expect(reves.players[reves.assigned[0]]!.isHuman).toBe(true);
  });

  it('el compañero no se mete en tu pelota: ni corre hacia ella ni la pega', () => {
    const match = practice('drive');
    match.rest(places(), 2, true);
    feedTo(match, 3.6, -6.8);
    const mate = match.players[1]!;
    let mostRight = -Infinity;
    let mateHits = 0;
    for (let i = 0; i < 2.5 * 120; i++) {
      match.step();
      mostRight = Math.max(mostRight, mate.x);
      for (const event of match.events) if (event.type === 'hit' && event.player === 1) mateHits++;
      match.events.length = 0;
    }
    expect(mateHits).toBe(0);
    // It stays on its side of the pair, closing the middle at most.
    expect(mostRight).toBeLessThan(0.5);
    expect(mate.call === 'mine' || mate.call === 'switch').toBe(false);
  });

  it('si no llegás, tu compañero la cubre y lo dice antes: «¡mía!»', () => {
    // A person who hardly moves: whatever goes to its side, it does not get to.
    const match = practice('drive', person({ speedFactor: 0.02 }));
    match.rest(places([{ x: 3, y: -BACK }, { x: -2.3, y: -BACK }]), 2, true);
    feedTo(match, 1.5, -6.2);
    expect(match.assigned[0]).toBe(1);
    expect(match.pairs[0].why).toBe('cover');
    const mate = match.players[1]!;
    let calledAt = -1;
    let hitAt = -1;
    for (let i = 0; i < 3 * 120 && hitAt < 0; i++) {
      match.step();
      if (calledAt < 0 && mate.call === 'mine') calledAt = match.time;
      for (const event of match.events) if (event.type === 'hit' && event.player === 1) hitAt = match.time;
      match.events.length = 0;
    }
    expect(calledAt).toBeGreaterThan(0);
    expect(hitAt).toBeGreaterThan(calledAt + 0.3);
  });

  it('en un partido entero, el compañero solo pega una pelota que era tuya después de avisar, y nunca la que te dejó', () => {
    let checked = 0;
    let covered = 0;
    for (const seed of [1, 2, 3]) {
      const config = createConfig();
      const match = new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [humanEntry(seed, withTactics(SKILLS.average, 1)), partnerEntry(config, 'beto', seed + 1)] },
          { name: 'B', players: [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)] },
        ],
      });
      const mate = match.players[1]!;
      while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
        const ball = match.trajectory?.id ?? -1;
        const why = match.pairs[0].why;
        const said = mate.callTraj === ball ? mate.call : null;
        match.step();
        for (const event of match.events) {
          if (event.type !== 'hit' || event.player !== 1 || event.kind === 'serve') continue;
          checked++;
          // A ball it was handed ("¡tuya!") it never plays.
          expect(said).not.toBe('yours');
          if (why === 'cover' || why === 'switch') {
            covered++;
            expect(['mine', 'switch', 'back']).toContain(said);
          }
        }
        match.events.length = 0;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(covered).toBeGreaterThan(0);
  });
});

describe('dobles: la pareja va atada', () => {
  function mover(x: number, y: number): Player {
    const player = createPlayer(0, 0, 0, person());
    player.x = x;
    player.y = y;
    return player;
  }

  it('el compañero sube cuando subís y baja cuando te quedás atrás', () => {
    const state = createPairState();
    const me = mover(2, -3.2);
    followPerson(state, me, 0);
    expect(state.home).toBe('net');

    // Half way it waits to see where the person goes.
    me.y = -5.8;
    followPerson(state, me, 0.1);
    expect(state.home).toBe('net');

    // At the back, and staying there: down it goes too, after a moment.
    me.y = -7.4;
    followPerson(state, me, 0.2);
    expect(state.home).toBe('net');
    followPerson(state, me, 0.7);
    expect(state.home).toBe('back');

    // Running back for a lob: at once.
    const lobbed = createPairState();
    lobbed.home = 'net';
    const runner = mover(2, -4.5);
    runner.vy = -4;
    followPerson(lobbed, runner, 0);
    expect(lobbed.home).toBe('back');
  });

  it('se desliza con la pelota y se cierra en la red', () => {
    const config = createConfig();
    const state = createPairState();
    const me = mover(2.3, -7.4);
    const mate = createPlayer(1, 0, 1, { ...person(), isHuman: false, manual: false });
    const spot = { x: 0, y: 0 };
    // The ball on the far right: the pair slides right, and the one on the left closes the middle.
    pairSpot(mate, me, state, 4, config, spot);
    expect(spot.x).toBeGreaterThan(-2.3);
    expect(spot.x).toBeLessThan(0);
    expect(spot.y).toBeCloseTo(-config.player.homeBack);
    // At the net the two are closer together.
    state.home = 'net';
    pairSpot(mate, me, state, 0, config, spot);
    expect(Math.abs(spot.x)).toBeLessThan(2.3);
    expect(spot.y).toBeCloseTo(-config.player.homeNet);
    // If the person crosses to the other side, the partner takes the side it left.
    me.x = -2.4;
    pairSpot(mate, me, state, 0, config, spot);
    expect(spot.x).toBeGreaterThan(0);
  });

  it('entre computadoras, cada pareja está junta (las dos en la red o las dos atrás) la mayor parte del punto', () => {
    const together: [number, number] = [0, 0];
    let live = 0;
    for (const seed of [4, 5]) {
      const config = createConfig();
      const match = new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [aiEntry(config, 'medium', seed), aiEntry(config, 'medium', seed + 1)] },
          { name: 'B', players: [aiEntry(config, 'medium', seed + 2), aiEntry(config, 'medium', seed + 3)] },
        ],
      });
      const zone = (player: Player): string => (Math.abs(player.y) < NET_LINE ? 'net' : Math.abs(player.y) > BACK_LINE ? 'back' : 'mid');
      while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
        match.step();
        match.events.length = 0;
        if (match.phase !== 'rally' || !match.rally.live) continue;
        live++;
        for (const team of [0, 1] as const) {
          const [a, b] = match.teams[team];
          if (zone(a!) === zone(b!) && zone(a!) !== 'mid') together[team]++;
        }
      }
    }
    expect(together[0]! / live).toBeGreaterThan(0.7);
    expect(together[1]! / live).toBeGreaterThan(0.7);
  });
});

describe('dobles: la pareja rival busca el hueco', () => {
  /**
   * Feeds `balls` comfortable balls to a strong computer pair and says where
   * its answers went, with the near pair standing still where it is put.
   */
  function answers(near: Array<{ x: number; y: number }>, balls = 40) {
    const config = createConfig();
    const strong = (seed: number): PlayerEntry => aiEntry(config, 'hard', seed);
    const match = new Match({
      config,
      seed: 21,
      practice: true,
      teams: [
        { name: 'A', players: [person(), person({ name: 'B' })] },
        { name: 'B', players: [strong(31), strong(32)] },
      ],
    });
    const out: Array<{ lob: boolean; x: number; depth: number }> = [];
    for (let n = 0; n < balls; n++) {
      match.rest([...near, { x: 2.3, y: 7.4 }, { x: -2.3, y: 7.4 }], 0, true);
      match.feed({ targetX: n % 2 ? 2 : -2, targetY: 6.8, kind: 'drive', params: { clearance: 0.9, apex: 0, speed: 12 } });
      for (let i = 0; i < 3 * 120; i++) {
        match.step();
        const hit = match.events.find((event) => event.type === 'hit' && event.team === 1);
        match.events.length = 0;
        if (hit && hit.type === 'hit') {
          const bounce = match.trajectory?.bounces.find((b) => b.y < 0);
          if (bounce) out.push({ lob: hit.kind === 'lob', x: bounce.x, depth: -bounce.y });
          break;
        }
      }
    }
    return out;
  }

  it('a una pareja partida (uno arriba, uno abajo) le tira por arriba del de la red o al hueco', () => {
    const split = answers([{ x: 1.8, y: -3.2 }, { x: -2.3, y: -7.8 }]);
    const together = answers([{ x: 2.3, y: -7.6 }, { x: -2.3, y: -7.6 }]);
    const punished = (shots: typeof split): number =>
      shots.filter((shot) => shot.lob || (shot.depth > 4 && shot.depth < 6.8)).length / shots.length;
    expect(split.length).toBeGreaterThan(25);
    expect(punished(split)).toBeGreaterThan(0.5);
    expect(punished(split)).toBeGreaterThan(punished(together) + 0.2);
  });

  it('al que se queda en tierra de nadie le tira a los pies', () => {
    const shots = answers([{ x: 2, y: -5.9 }, { x: -2.3, y: -3.2 }]);
    const atFeet = shots.filter((shot) => !shot.lob && Math.abs(shot.x - 2) < 1.8 && shot.depth > 4.6 && shot.depth < 7.2);
    expect(atFeet.length / shots.length).toBeGreaterThan(0.4);
  });
});

describe('alcance real', () => {
  function realConfig(): GameConfig {
    const config = createConfig();
    config.player.realReach = true;
    return config;
  }

  it('es el mismo para todos: la persona no llega más lejos que la máquina', () => {
    const config = realConfig();
    const human = createPlayer(0, 0, 0, person({ reachScale: 1.3 }));
    const machine = createPlayer(1, 1, 0, { ...person(), isHuman: false, manual: false });
    expect(playerReach(human, config)).toBe(config.player.real.reach);
    expect(playerReach(machine, config)).toBe(config.player.real.reach);
    // Over the head the arm goes up, not out.
    expect(playerReach(human, config, config.player.maxContactZ)).toBeCloseTo(config.player.real.highReach);
    expect(playerReach(human, config, 2.2)).toBeLessThan(config.player.real.reach);
    // And the floor is the floor: lower than this, the ball is lost; lunging, the body cannot get that low.
    expect(lowestContact(config, false)).toBeCloseTo(0.2);
    expect(lowestContact(config, true)).toBeGreaterThan(lowestContact(config, false));
    // Today's generous reach is still there, and it is longer.
    const generous = createConfig();
    expect(playerReach(human, generous)).toBeGreaterThan(config.player.real.reach + config.player.real.lunge);
  });

  /** A ball struck from the far side that passes the near baseline area at `x`. */
  function passing(x: number) {
    const config = createConfig();
    const launch = solveShot(x, 7, 1, x, -8.6, config.shots.specs.drive, config.physics, config.court);
    const ball: BallState = { ...createBall(), x, y: 7, z: 1, vx: launch.vx, vy: launch.vy, vz: launch.vz };
    const rally = createRally();
    registerHit(rally, 1, false, 1);
    return predictTrajectory(ball, rally, 0, config);
  }

  it('se llega con una zancada hasta 1,6 m; más lejos, no', () => {
    const near = passing(0);
    const reachable = (config: GameConfig, offset: number): boolean => {
      const player = createPlayer(0, 0, 0, person({ reachScale: 1.3 }));
      player.x = offset;
      player.y = -7;
      return contactNear(near, player, 0, config, 6, 0) !== null;
    };
    expect(reachable(realConfig(), 1.4)).toBe(true);
    expect(reachable(realConfig(), 1.75)).toBe(false);
    // With today's reach the person got there.
    expect(reachable(createConfig(), 1.6)).toBe(true);
  });

  it('una pelota al ras del piso no se pega', () => {
    const config = realConfig();
    // A chiquita that dies: every contact anybody can make is at least at knee... at least off the floor.
    const launch = solveShot(0, 6, 1, 0.2, -2, config.shots.specs.drop, config.physics, config.court);
    const ball: BallState = { ...createBall(), x: 0, y: 6, z: 1, vx: launch.vx, vy: launch.vy, vz: launch.vz, grip: 0.5 };
    const rally = createRally();
    registerHit(rally, 1, false, 1);
    const trajectory = predictTrajectory(ball, rally, 0, config);
    const player = createPlayer(0, 0, 0, { ...person(), isHuman: false, manual: false });
    player.x = 0.5;
    player.y = -3;
    const plan = planIntercept(trajectory, player, 0, config);
    if (plan) expect(plan.z).toBeGreaterThanOrEqual(lowestContact(config, false));
  });

  it('el compañero es el mismo personaje, con manos más firmes y sin regalarle pelotas al rival', () => {
    const config = createConfig();
    const rival = config.rivals.beto;
    const mate = asPartner(rival);
    expect(mate.feed).toBe(0);
    expect(mate.timingSigma).toBeLessThan(rival.timingSigma);
    expect(mate.errorScale).toBeLessThan(rival.errorScale);
    // Same legs.
    expect(mate.speedFactor).toBe(rival.speedFactor);
  });
});

describe('dobles: partidos enteros', () => {
  function doubles(seed: number, realReach = false) {
    const config = createConfig();
    config.player.realReach = realReach;
    return new Match({
      config,
      seed,
      teams: [
        { name: 'A', players: [humanEntry(seed, withTactics(SKILLS.average, 1)), partnerEntry(config, 'beto', seed + 1)] },
        { name: 'B', players: [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)] },
      ],
    });
  }

  it('terminan, con los dos alcances', () => {
    for (const real of [false, true]) {
      const summary = playMatch(doubles(9, real), 3600);
      expect(summary.stalled).toBe(false);
      expect(summary.winner).toBeGreaterThanOrEqual(0);
    }
  });

  it('con la misma semilla el partido es idéntico, golpe por golpe', () => {
    const record = (seed: number): string[] => {
      const log: string[] = [];
      playMatch(doubles(seed, true), 3600, (event) => {
        if (event.type === 'hit') log.push(`${event.player}:${event.kind}:${event.x.toFixed(4)}:${event.speed.toFixed(4)}`);
        else if (event.type === 'point') log.push(`point:${event.winner}:${event.reason}`);
      });
      return log;
    };
    expect(record(12)).toEqual(record(12));
    expect(record(12)).not.toEqual(record(13));
  });
});
