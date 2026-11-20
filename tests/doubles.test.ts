import { describe, expect, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { asPartner } from '../src/characters/style';
import { createConfig, type GameConfig } from '../src/config';
import { createBall, type BallState } from '../src/sim/ball';
import { InputState } from '../src/input/state';
import { contactNear, planIntercept } from '../src/sim/intercept';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
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
    // On its side, and close to whoever plays that side.
    expect(['side', 'body']).toContain(match.pairs[0].why);

    match.rest(places(), 2, true);
    feedTo(match, -3.4, -6.5);
    expect(match.assigned[0]).toBe(1);
    expect(['side', 'body']).toContain(match.pairs[0].why);
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
    // Covering a ball of the person's is rare: these matches have some.
    for (const seed of [3, 4, 5, 6]) {
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

describe('dobles: el globo que te pasa por tu lado es tuyo (docs/red.md)', () => {
  it('si te quedás en la red, el compañero te dice «¡atrás!», cruza tarde («¡voy!») y después se queda atrás llamándote', () => {
    const match = practice('reves');
    const mate = match.players[0]!;
    const me = match.players[1]!;
    // Both at the net; a lob from the far side lands deep behind the person, who never moves.
    match.rest([{ x: 1.8, y: -3.2 }, { x: -1.8, y: -2.8 }, { x: 0, y: 7 }, { x: 2.5, y: 7.4 }], 2, true);
    match.feed({ targetX: -2.6, targetY: -8.4, kind: 'lob', params: { clearance: 2, apex: 5.2, speed: 30 } });
    const struckAt = match.time;
    const calls: Array<{ call: string; at: number }> = [];
    let played: Extract<SimEvent, { type: 'hit' }> | null = null;
    for (let i = 0; i < 5 * 120 && !played; i++) {
      match.step();
      if (mate.call && mate.callAt === match.time) calls.push({ call: mate.call, at: match.time - struckAt });
      for (const event of match.events) if (event.type === 'hit' && event.team === 0) played = event;
      match.events.length = 0;
    }
    // First it tells the person to go back; the person does not, and it crosses for it after all.
    expect(calls[0]?.call).toBe('back');
    expect(calls.find((c) => c.call === 'switch')?.at).toBeGreaterThanOrEqual(0.4);
    expect(played?.player).toBe(mate.id);
    expect(Math.abs(me.y)).toBeLessThan(4);
    // Defending off the glass, with the person still at the net: it stays back and calls the person back.
    expect(played?.kind).toBe('wallExit');
    expect(match.pairs[0].anchor).toBe(mate.id);
    expect(mate.call).toBe('back');
    for (let i = 0; i < 120; i++) match.step();
    expect(Math.abs(mate.y)).toBeGreaterThan(6.5);
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

describe('dobles: la pareja rival también se desordena, y se le puede castigar', () => {
  /** Two plain players of the given composure against two steady ones, and what came apart in their pair. */
  function disorder(composure: number, seeds: number[]) {
    let astray = 0;
    let doubts = 0;
    let beckons = 0;
    let exchanges = 0;
    for (const seed of seeds) {
      const config = createConfig();
      const loose = (n: number): PlayerEntry => ({ ...aiEntry(config, 'medium', n), composure });
      const match = new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [{ ...aiEntry(config, 'medium', seed + 10), composure: 0.9 }, { ...aiEntry(config, 'medium', seed + 11), composure: 0.9 }] },
          { name: 'B', players: [loose(seed + 12), loose(seed + 13)] },
        ],
      });
      const far = match.teams[1];
      const was = [null, null] as Array<string | null>;
      let doubted = -1;
      while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
        match.step();
        for (const event of match.events) if (event.type === 'hit' && event.team === 1) exchanges++;
        match.events.length = 0;
        far.forEach((player, i) => {
          if (player.astray && player.astray !== was[i]) astray++;
          was[i] = player.astray;
          if (player.call === 'up' && player.callAt === match.time) beckons++;
        });
        if (match.pairs[1].doubted !== doubted) {
          doubted = match.pairs[1].doubted;
          if (doubted >= 0) doubts++;
        }
      }
    }
    return { astray, doubts, beckons, exchanges };
  }

  it('se desordena más quien tiene menos entereza: se queda atrás, a mitad de camino o duda en el medio', () => {
    const shaky = disorder(0.2, [3, 4]);
    const steady = disorder(0.9, [3, 4]);
    expect(shaky.astray).toBeGreaterThan(10);
    expect(shaky.doubts).toBeGreaterThan(5);
    expect(shaky.astray).toBeGreaterThan(steady.astray * 2.5);
    expect(shaky.doubts).toBeGreaterThan(steady.doubts * 2);
    // When one goes up without the other, it calls the partner up: that is how the other side sees it.
    expect(shaky.beckons).toBeGreaterThan(0);
  });

  it('tu compañero nunca se desordena ni duda: la pareja con una persona la lleva la persona', () => {
    for (const seed of [5, 6]) {
      const config = createConfig();
      const match = new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [humanEntry(seed, withTactics(SKILLS.average, 1)), { ...partnerEntry(config, 'beto', seed + 1), composure: 0 }] },
          { name: 'B', players: [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)] },
        ],
      });
      const mate = match.players[1]!;
      while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
        match.step();
        match.events.length = 0;
        expect(mate.astray).toBeNull();
        expect(mate.doubtUntil).toBe(0);
        expect(match.pairs[0].doubted).toBe(-1);
      }
    }
  });

  /** Lobs into one spot of the far half, against a far pair standing where it is put: how many it does not return. */
  function notReturned(far: Array<{ x: number; y: number }>, composure: number, target: { x: number; y: number }, balls = 60): number {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 41,
      practice: true,
      teams: [
        { name: 'A', players: [person(), person({ name: 'B' })] },
        { name: 'B', players: [{ ...aiEntry(config, 'medium', 51), composure }, { ...aiEntry(config, 'medium', 52), composure }] },
      ],
    });
    let missed = 0;
    for (let n = 0; n < balls; n++) {
      match.rest([{ x: 2.3, y: -7.4 }, { x: -2.3, y: -7.4 }, ...far], 0, true);
      match.feed({ targetX: target.x, targetY: target.y, kind: 'lob', params: { clearance: 2, apex: 5.2, speed: 30 } });
      let back = false;
      for (let i = 0; i < 4 * 120 && match.rally.live; i++) {
        match.step();
        if (match.events.some((event) => event.type === 'hit' && event.team === 1)) back = true;
        match.events.length = 0;
        if (back) break;
      }
      if (!back) missed++;
    }
    return missed / balls;
  }

  it('el hueco de una pareja partida se castiga: un globo por arriba del que subió solo vuelve menos, y menos todavía si no tiene entereza', () => {
    const split = [{ x: 2, y: 3.2 }, { x: -2.3, y: 7.6 }];
    const together = [{ x: 2.3, y: 7.6 }, { x: -2.3, y: 7.6 }];
    // Over the one at the net, deep on its side: the one at the back has to cross the whole diagonal.
    const hole = { x: 2.6, y: 8.4 };
    const shaky = notReturned(split, 0.2, hole);
    const steady = notReturned(split, 0.9, hole);
    const formed = notReturned(together, 0.2, hole);
    expect(shaky).toBeGreaterThan(formed + 0.1);
    expect(shaky).toBeGreaterThan(steady + 0.05);
  });
});

describe('dobles: las señas, solo cuando de quién es la pelota no se ve sola', () => {
  /** What player `id` shows with the body in the next `seconds`, and what it says. */
  function watchCalls(match: Match, id: number, seconds: number): { shown: string[]; said: string[] } {
    const player = match.players[id]!;
    const shown: string[] = [];
    const said: string[] = [];
    for (let i = 0; i < seconds * 120; i++) {
      match.step();
      match.events.length = 0;
      if (player.call && player.callAt === match.time) {
        said.push(player.call);
        if (player.callShown) shown.push(player.call);
      }
    }
    return { shown, said };
  }

  /** A pair (the person and a partner, or two computer players) in the near half, where `spots` says; the far pair feeds. */
  function court(near: [PlayerEntry, PlayerEntry], spots: Array<{ x: number; y: number }>): Match {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 7,
      practice: true,
      teams: [
        { name: 'A', players: near },
        { name: 'B', players: [{ ...aiEntry(config, 'medium', 5), controller: idle }, { ...aiEntry(config, 'medium', 6), controller: idle }] },
      ],
    });
    match.rest(places(spots), 2, true);
    return match;
  }

  it('una pelota que va claramente a uno no lleva seña: ni «¡mía!» de quien va ni «¡tuya!» de quien la deja', () => {
    // You on the drive side, your partner on the left. Wide on its side, at its body, wide on yours.
    for (const [x, y] of [
      [-3.4, -6.5],
      [-2.3, -7],
      [3.4, -6.5],
    ] as const) {
      const match = practice('drive');
      match.rest(places(), 2, true);
      feedTo(match, x, y);
      expect(match.pairs[0].unclear, `pelota a (${x}, ${y})`).toBe(false);
      expect(watchCalls(match, 1, 1.4).shown, `pelota a (${x}, ${y})`).toEqual([]);
    }
  });

  it('una pelota entre los dos, que los dos llegan igual de cómodos, la avisan con el cuerpo: quien va, «¡mía!», y quien la deja, «¡tuya!»', () => {
    // You on the revés side: the middle is yours, and your partner shows you so.
    const reves = practice('reves');
    reves.rest(places(), 2, true);
    feedTo(reves, 0, -6.5);
    expect(reves.players[reves.assigned[0]]!.isHuman).toBe(true);
    expect(reves.pairs[0].unclear).toBe(true);
    // (The person here stands still, so in the end the partner covers it: «¡tuya!... ¡mía!», shown as well.)
    expect(watchCalls(reves, 0, 1.2).shown[0]).toBe('yours');

    // You on the drive side: the middle is your partner's, and it shows it goes.
    const drive = practice('drive');
    drive.rest(places(), 2, true);
    feedTo(drive, 0, -6.5);
    expect(drive.assigned[0]).toBe(1);
    expect(watchCalls(drive, 1, 1.2).shown).toEqual(['mine']);

    // Between two computer players, both of them. (Steady ones: a pair without composure may doubt instead, and then
    // each one points at the other.)
    const config = createConfig();
    const steady = (seed: number): PlayerEntry => ({ ...partnerEntry(config, 'medium', seed), composure: 1 });
    const pair = court([steady(3), steady(4)], [{ x: 2.3, y: -BACK }, { x: -2.3, y: -BACK }]);
    feedTo(pair, 0, -6.5);
    const owner = pair.assigned[0];
    expect(pair.pairs[0].unclear).toBe(true);
    const shown: string[][] = [[], []];
    for (let i = 0; i < 1.2 * 120; i++) {
      pair.step();
      pair.events.length = 0;
      for (const id of [0, 1]) {
        const player = pair.players[id]!;
        if (player.call && player.callShown && player.callAt === pair.time) shown[id]!.push(player.call);
      }
    }
    expect(shown[owner]).toEqual(['mine']);
    expect(shown[1 - owner]).toEqual(['yours']);
  });

  it('a tu lado, entre los dos, tu compañero muestra lo que no dice la regla; lo que sí dice, no hace falta mostrarlo', () => {
    // You on the drive side, a little in from your lane; the ball between the two of you, through the middle,
    // which by the rule is your partner's (it has the forehand to it). With you slow to get there, your partner
    // keeps it, as the rule says: nothing to show.
    const config = createConfig();
    const spots = [{ x: 2, y: -BACK }, { x: -2.3, y: -BACK }];
    const slow = court([person({ speedFactor: 0.5 }), partnerEntry(config, 'medium', 3)], spots);
    feedTo(slow, -0.15, -6.5);
    expect(slow.assigned[0]).toBe(1);
    expect(slow.pairs[0].unclear).toBe(false);
    expect(watchCalls(slow, 1, 1.2).shown).toEqual([]);

    // A partner slow to read the ball leaves it to you, against the rule, and shows it.
    const late = court([person(), { ...partnerEntry(config, 'medium', 3), reaction: 0.8 }], spots);
    feedTo(late, -0.15, -6.5);
    expect(late.assigned[0]).toBe(0);
    expect(late.pairs[0].unclear).toBe(true);
    expect(watchCalls(late, 1, 1.6).shown[0]).toBe('yours');

    // Two computer players in the same places understand each other: it is said, and nothing is shown.
    const two = court([{ ...partnerEntry(config, 'medium', 2), composure: 1 }, { ...partnerEntry(config, 'medium', 3), reaction: 0.8, composure: 1 }], spots);
    feedTo(two, -0.15, -6.5);
    expect(two.assigned[0]).toBe(0);
    expect(two.pairs[0].unclear).toBe(false);
    expect(watchCalls(two, 1, 1.6)).toEqual({ shown: [], said: ['yours'] });
  });

  it('una pelota que cambia de manos sí se muestra: tu compañero la cubre con un «¡mía!» a la vista', () => {
    const match = practice('drive', person({ speedFactor: 0.02 }));
    match.rest(places([{ x: 3, y: -BACK }, { x: -2.3, y: -BACK }]), 2, true);
    feedTo(match, 1.5, -6.2);
    expect(match.pairs[0].why).toBe('cover');
    expect(watchCalls(match, 1, 1.2).shown).toEqual(['mine']);
  });

  it('lo que se dice sin mostrarlo no llega a la pantalla', () => {
    const match = practice('drive');
    match.rest(places(), 2, true);
    match.step();
    const mate = match.players[1]!;
    const scene = createScene();
    const options: SceneOptions = { aids: 'minimal', aidStrength: 1, reduceMotion: false, debug: false, cueLead: 0, tutorial: null, cast: [], acts: [] };
    mate.call = 'mine';
    mate.callAt = match.time;
    mate.callShown = false;
    fillScene(scene, match, 1, new InputState(), options);
    expect(scene.players[1]!.call).toBeNull();
    mate.callShown = true;
    fillScene(scene, match, 1, new InputState(), options);
    expect(scene.players[1]!.call?.kind).toBe('mine');
  });

  it('en partidos enteros tu compañero hace seña en una minoría de las pelotas, y la pareja rival también', { timeout: 60_000 }, () => {
    const balls = [0, 0];
    const signed = [0, 0];
    for (const seed of [21, 22, 23]) {
      const config = createConfig();
      const match = new Match({
        config,
        seed,
        teams: [
          { name: 'A', players: [partnerEntry(config, 'beto', seed + 1), humanEntry(seed, withTactics(SKILLS.average, 1))] },
          { name: 'B', players: [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)] },
        ],
      });
      // The ball on its way to a pair, and whether that pair showed anything about it.
      let receiving = -1;
      let shown = false;
      while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
        match.step();
        for (const event of match.events) {
          if (event.type !== 'hit' && event.type !== 'point') continue;
          if (receiving >= 0 && shown) signed[receiving]!++;
          shown = false;
          receiving = event.type === 'hit' && event.kind !== 'serve' ? 1 - event.team : -1;
          if (receiving >= 0) balls[receiving]!++;
        }
        match.events.length = 0;
        for (const player of match.players) {
          if (player.team === receiving && player.call && player.callShown && player.callAt === match.time) shown = true;
        }
      }
    }
    expect(balls[0]).toBeGreaterThan(150);
    // Before, about three balls in four had one, on each side of the net.
    expect(signed[0]! / balls[0]!).toBeLessThan(0.35);
    expect(signed[0]).toBeGreaterThan(0);
    expect(signed[1]! / balls[1]!).toBeLessThan(0.45);
  });
});
