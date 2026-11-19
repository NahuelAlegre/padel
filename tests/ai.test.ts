import { describe, expect, it } from 'vitest';
import { CAST } from '../src/characters/cast';
import { toAILevel, withAttitude } from '../src/characters/style';
import { createConfig, type RivalId } from '../src/config';
import { AIController, demandOf } from '../src/control/ai';
import { Rng } from '../src/core/rng';
import { planIntercept, type InterceptPlan } from '../src/sim/intercept';
import { createBall } from '../src/sim/ball';
import { createRally, registerHit } from '../src/sim/rules';
import { solveShot } from '../src/sim/shots';
import { pointAt, predictTrajectory } from '../src/sim/trajectory';
import { Match, type Controller, type PlayerEntry } from '../src/sim/match';
import { ATTITUDE, ATTITUDES, attitudeFrom, cameToIt, createPairState, followPerson, shouldCover, type Attitude } from '../src/sim/pair';
import { createPlayer, type Player } from '../src/sim/player';
import type { PlayerIntent, ShotIntent } from '../src/sim/types';
import { defaultSettings, partnerAttitude, readSettings } from '../src/ui/settings';
import { humanEntry, LEVELS, pairEntry, partnerEntry, SKILLS, withTactics } from './helpers';
import { PairProbe } from './probe';

/**
 * The computer players look like people: what they get right and what they
 * get wrong. The doubles report (`npm run sim`, tests/sim/doubles.sim.ts)
 * measures the same things over many matches; this keeps the rules.
 */

/** A person who stands wherever it is and swings at whatever comes within its reach. */
class Still implements Controller {
  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (match.phase === 'serve' && match.serverId === me.id) intent.swing = { aim: 0, depth: 0.6, lob: false, power: 1 };
    if (me.plan && !me.swing && match.rally.live && match.rally.hitter !== me.team) intent.swing = { aim: 0, depth: 0.7, lob: false, power: 1 };
  }
}

/** A player that does nothing at all: it stays where it is put. */
const idle: Controller = { update() {} };

function person(overrides: Partial<PlayerEntry> = {}): PlayerEntry {
  return { name: 'Vos', isHuman: true, manual: true, speedFactor: 1, reaction: 0, errorScale: 1, reachScale: 1, hand: 1, controller: idle, ...overrides };
}

interface Doubles {
  seed: number;
  side: 'drive' | 'reves';
  real: boolean;
  who: 'still' | 'positional';
  mate?: RivalId;
  attitude?: Attitude;
}

/** You and a partner against two of the cast, each with its own attitude, as the game sets it up. */
function doubles({ seed, side, real, who, mate = 'beto', attitude }: Doubles): Match {
  const config = createConfig();
  config.player.realReach = real;
  const me = who === 'still' ? { ...humanEntry(seed, SKILLS.average), controller: new Still() } : humanEntry(seed, withTactics(SKILLS.average, 1));
  const partner = partnerEntry(config, mate, seed + 1, 'IA', attitude);
  const [a, b] = (['beto', 'romina', 'chela'] as RivalId[]).filter((id) => id !== mate) as [RivalId, RivalId];
  return new Match({
    config,
    seed,
    teams: [
      { name: 'A', players: side === 'reves' ? [partner, me] : [me, partner] },
      { name: 'B', players: [pairEntry(config, a, seed + 2), pairEntry(config, b, seed + 3)] },
    ],
  });
}

function playWatched(match: Match, onStep?: () => void): PairProbe {
  const probe = new PairProbe(match);
  while (match.phase !== 'matchOver' && match.tick < 1800 * 120) {
    match.step();
    probe.step();
    onStep?.();
    match.events.length = 0;
  }
  return probe;
}

describe('el compañero no se queda mirando', () => {
  it('una pelota que pasa al alcance del compañero, y no del tuyo, nunca queda sin que nadie la intente', () => {
    let seen = 0;
    for (const side of ['reves', 'drive'] as const) {
      for (const real of [false, true]) {
        for (const who of ['still', 'positional'] as const) {
          const probe = playWatched(doubles({ seed: 61 + (real ? 1 : 0) + (side === 'drive' ? 2 : 0), side, real, who }));
          seen += probe.totals.byPartner;
          expect(probe.totals.untouchedPartner, `${side} ${real ? 'real' : 'actual'} ${who}: ${JSON.stringify(probe.totals.untouchedWhy)}`).toBe(0);
        }
      }
    }
    // Plenty of them went right by it.
    expect(seen).toBeGreaterThan(100);
  });

  it('tampoco con otra actitud, ni entre dos computadoras', () => {
    for (const attitude of ATTITUDES) {
      const probe = playWatched(doubles({ seed: 71, side: 'reves', real: true, who: 'still', attitude }));
      expect(probe.totals.untouchedPartner, attitude).toBe(0);
    }
    const config = createConfig();
    const four = new Match({
      config,
      seed: 73,
      teams: [
        { name: 'A', players: [pairEntry(config, 'romina', 1), pairEntry(config, 'beto', 2)] },
        { name: 'B', players: [pairEntry(config, 'chela', 3), pairEntry(config, 'medium', 4)] },
      ],
    });
    const probe = playWatched(four);
    // Enough of the far pair's balls went by them for the rule to be tested (points are shorter than they were).
    expect(probe.totals.byRivals).toBeGreaterThan(20);
    expect(probe.totals.untouchedRivals).toBe(0);
  });
});

/**
 * A practice court with a pair on each side: the person and a computer
 * partner near the camera, two that do nothing on the far side. Ids go in
 * order: the near pair is 0 and 1 (0 plays the right), the far one 2 and 3.
 */
function practice(side: 'drive' | 'reves', me: PlayerEntry, mate: PlayerEntry, config = createConfig()): Match {
  return new Match({
    config,
    seed: 7,
    practice: true,
    teams: [
      { name: 'A', players: side === 'drive' ? [me, mate] : [mate, me] },
      { name: 'B', players: [{ ...pairEntry(config, 'medium', 5), controller: idle }, { ...pairEntry(config, 'medium', 6), controller: idle }] },
    ],
  });
}

/** Steps the match for `seconds`, telling whether `id` swung (hit or missed) and when it hit. */
function run(match: Match, id: number, seconds: number): { swung: boolean; hitAt: number; called: string[] } {
  const player = match.players[id]!;
  let swung = false;
  let hitAt = -1;
  const called: string[] = [];
  for (let i = 0; i < seconds * 120 && hitAt < 0; i++) {
    match.step();
    if (player.swing) swung = true;
    if (player.call && player.callAt === match.time) called.push(player.call);
    for (const event of match.events) {
      if ((event.type === 'hit' || event.type === 'whiff') && event.player === id) swung = true;
      if (event.type === 'hit' && event.player === id) hitAt = match.time;
    }
    match.events.length = 0;
  }
  return { swung, hitAt, called };
}

describe('lo que le llega al cuerpo', () => {
  it('una pelota rápida al cuerpo, antes de leerla, la bloquea: no se queda congelado', () => {
    const config = createConfig();
    // Slow to read, like Beto: the ball is on it before it would have moved.
    const mate = { ...partnerEntry(config, 'beto', 3), reaction: 0.4 };
    const match = practice('reves', person(), mate, config);
    match.rest([{ x: 1.8, y: -3.2 }, { x: -2.3, y: -7.4 }, { x: 1.6, y: 5.5 }, { x: -2.3, y: 7.4 }], 2, true);
    // A flat, fast ball straight at it: it gets there in less than its reaction.
    match.feed({ targetX: 1.8, targetY: -6, kind: 'drive', params: { clearance: 0.15, apex: 0, speed: 24 }, z: 1.2 });
    expect(match.assigned[0]).toBe(0);
    const { swung } = run(match, 0, 1);
    expect(swung).toBe(true);
  });

  it('la del medio que va al cuerpo de tu compañero es suya, aunque vos tengas la derecha hacia el medio', () => {
    const config = createConfig();
    const match = practice('reves', person(), partnerEntry(config, 'medium', 3), config);
    // You on the revés side, the middle on your forehand, both at the back and close together.
    match.rest([{ x: 1.2, y: -7.4 }, { x: -1.9, y: -7.4 }, { x: 0, y: 6 }, { x: 2.5, y: 7.4 }], 2, true);
    match.feed({ targetX: 0.4, targetY: -6.4, kind: 'drive', params: { clearance: 0.9, apex: 0, speed: 14 } });
    // Through the middle of the pair, but by your partner's body and well away from yours: your partner's.
    expect(Math.abs(match.pairs[0].offMiddle)).toBeLessThanOrEqual(0.9);
    expect(match.pairs[0].why).toBe('body');
    expect(match.assigned[0]).toBe(0);
    // And it goes for it.
    expect(run(match, 0, 3).hitAt).toBeGreaterThan(0);
  });

  /** A player standing at (x, y), moving at (vx, vy). */
  function at(x: number, y: number, more: Partial<PlayerEntry> = {}, vx = 0, vy = 0): Player {
    const player = createPlayer(0, 0, 0, person(more));
    player.x = x;
    player.y = y;
    player.vx = vx;
    player.vy = vy;
    return player;
  }
  const contact = (x: number, y: number, t: number, more: Partial<InterceptPlan> = {}): InterceptPlan => ({
    trajId: 1,
    t,
    x,
    y,
    z: 1,
    stanceX: x - 0.6,
    stanceY: y,
    kind: 'bounce',
    reachable: true,
    slack: 0.4,
    ...more,
  });

  it('una pelota tuya que terminó yendo al cuerpo de tu compañero es suya: la juega desde donde está', () => {
    const mate = at(1.5, -7.4, { isHuman: false, manual: false, attitude: 'balanced' });
    const you = at(-2, -7.4);
    const coming = contact(1.3, -7.1, 0.5);
    expect(cameToIt(mate, you, coming, null, 0, 5.2, 1.6)).toBe(true);
    // Unless you are about to play it first.
    expect(cameToIt(mate, you, coming, contact(-1.6, -7.2, 0.3), 0, 5.2, 1.6)).toBe(false);
    // Not yet: there is still time for you to go.
    expect(cameToIt(mate, you, contact(1.3, -7.1, 1.5), null, 0, 5.2, 1.6)).toBe(false);
    // The passive one leaves it to you, but not at the last moment if you are not going.
    const passive = at(1.5, -7.4, { isHuman: false, manual: false, attitude: 'passive' });
    expect(cameToIt(passive, you, coming, null, 0, 5.2, 1.6)).toBe(false);
    expect(cameToIt(passive, you, contact(1.3, -7.1, 0.2), null, 0, 5.2, 1.6)).toBe(true);
  });

  it('si no vas, te la cubre; si estás yendo, te la deja', () => {
    const mate = at(1.5, -7.4, { isHuman: false, manual: false, attitude: 'balanced' });
    const coming = contact(0.6, -6.6, 0.6, { stanceX: 0.4, stanceY: -6.8 });
    const run = contact(0.6, -6.6, 0.6, { slack: 0.2 });
    // You are standing still, far from it: it covers.
    expect(shouldCover(mate, at(-2.5, -7.4), coming, run, null, 0, 5.2, 1.6)).toBe(true);
    // You are on your way to it, fast enough to get there: it is yours.
    expect(shouldCover(mate, at(-2.5, -7.4, {}, 5, 1), coming, run, null, 0, 5.2, 1.6)).toBe(false);
    // You cannot get there however you run: it covers, wherever it is.
    expect(shouldCover(mate, at(-2.5, -7.4, {}, 5, 1), contact(-3, -9, 2), { ...run, reachable: false }, null, 0, 5.2, 1.6)).toBe(true);
  });
});

describe('aciertos y errores con motivo', () => {
  /** A computer player of the given level standing at the back of the far half, and what it decides. */
  function rival(level = LEVELS.medium) {
    const controller = new AIController(level, new Rng(5));
    const choose = (controller as unknown as { chooseShot: (m: Match, p: Player, plan: InterceptPlan) => ShotIntent }).chooseShot.bind(controller);
    const swingTime = (controller as unknown as { swingTime: (plan: InterceptPlan, demand: number) => number }).swingTime.bind(controller);
    const lastSwing = (controller as unknown as { lastSwing: (m: Match, plan: InterceptPlan) => number }).lastSwing.bind(controller);
    /** As if the ball of `plan` were this demanding: what it decided for it. */
    const demanding = (p: InterceptPlan, demand: number): void => {
      Object.assign(controller as unknown as { lastPlan: InterceptPlan; demand: number }, { lastPlan: p, demand });
    };
    const config = createConfig();
    const match = new Match({ config, seed: 3, teams: [{ name: 'A', players: [person()] }, { name: 'B', players: [{ ...pairEntry(config, 'medium', 4), controller }] }] });
    return { choose, swingTime, lastSwing, demanding, match, me: match.players[1]! };
  }
  const plan = (slack: number, more: Partial<InterceptPlan> = {}): InterceptPlan => ({
    trajId: 0,
    t: 10,
    x: 0,
    y: 7,
    z: 1,
    stanceX: 0.6,
    stanceY: 7.2,
    kind: 'bounce',
    reachable: slack >= -0.03,
    slack,
    ...more,
  });

  it('una pelota cómoda casi nunca se falla; una que le exigiste, mucho más seguido', () => {
    const { swingTime, choose, demanding, match, me } = rival();
    const late = (demand: number): number => {
      let n = 0;
      for (let i = 0; i < 600; i++) if (swingTime(plan(0.4), demand) - 10 > match.config.timing.good) n++;
      return n / 600;
    };
    const comfortable = late(0);
    const demanded = late(1);
    expect(comfortable).toBeLessThan(0.02);
    expect(demanded).toBeGreaterThan(comfortable * 5);
    expect(demanded).toBeGreaterThan(0.15);
    // And the ball leaves the racket cleaner than usual, or wilder.
    const easy = plan(0.4);
    demanding(easy, 0);
    const calm = choose(match, me, easy);
    const hard = plan(0.4);
    demanding(hard, 1);
    const wild = choose(match, me, hard);
    expect(calm.scatter ?? 1).toBeLessThan(1);
    expect(wild.scatter ?? 1).toBeGreaterThan(1.5);
    expect(calm.why).toBeUndefined();
    expect(['forced', 'gamble']).toContain(wild.why);
  });

  it('lo que la hace exigente es lo que hizo el otro: colocación, profundidad, ritmo, sorpresa', () => {
    const { match, me } = rival();
    const config = match.config;
    // A comfortable ball: to where it was waiting, off the back glass with time to spare, at the pace of its last one.
    const launch = solveShot(0.6, -4, 1, 0.6, 7, { clearance: 0.9, apex: 0, speed: 11 }, config.physics, config.court);
    const ball = { ...createBall(), x: 0.6, y: -4, z: 1, vx: launch.vx, vy: launch.vy, vz: launch.vz };
    const rally = createRally();
    registerHit(rally, 0, false, 1);
    match.trajectory = predictTrajectory(ball, rally, match.time, config);
    me.x = 0;
    me.y = 7.4;
    const comfortable = planIntercept(match.trajectory, me, match.time, config)!;
    const at = pointAt(match.trajectory, comfortable.t)!;
    const pace = Math.hypot(at.vx, at.vy, at.vz);
    const easy = demandOf(match, me, comfortable, me.x, me.y, pace);
    // Where it waited makes no difference while there is time to get there; from the net in the
    // other corner there is none: pulled out of its place.
    expect(demandOf(match, me, comfortable, me.x + 3.5, me.y, pace)).toBeCloseTo(easy);
    const pulled = demandOf(match, me, comfortable, me.x - 4, me.y - 4, pace);
    // A change of pace, and a surprise.
    const changed = demandOf(match, me, comfortable, me.x, me.y, pace + 8);
    me.read = me.reaction * 1.6;
    const surprised = demandOf(match, me, comfortable, me.x, me.y, pace);
    expect(easy).toBeLessThan(0.1);
    expect(pulled).toBeGreaterThan(easy + 0.4);
    expect(changed).toBeGreaterThan(easy + 0.2);
    expect(surprised).toBeGreaterThan(easy + 0.2);
  });

  it('nunca se queda mirando: si su cuerpo iba a llegar después de que la pelota muera, le pega antes, tarde, y no le llega', () => {
    const { lastSwing, match } = rival();
    // A ball that dies a moment after the contact it planned.
    const trajectory = { id: 9, t0: 9, points: [], bounces: [], end: { t: 10.05, result: { kind: 'point' as const, winner: 0 as const, reason: 'doubleBounce' as const } } };
    match.trajectory = trajectory;
    expect(lastSwing(match, plan(-0.1, { trajId: 9 }))).toBeLessThan(10.05);
    expect(lastSwing(match, plan(-0.1, { trajId: 9 }))).toBeGreaterThanOrEqual(10);
    // And it never waits past the moment it would give up on this contact.
    match.trajectory = { ...trajectory, end: null };
    expect(lastSwing(match, plan(0.2, { trajId: 9 }))).toBeLessThanOrEqual(10 + match.config.timing.lateMax);
  });

  it('un bloqueo al cuerpo no se apunta: sale al medio, más suave y menos preciso', () => {
    const { choose, match, me } = rival();
    for (let i = 0; i < 20; i++) {
      const block = choose(match, me, plan(0.2, { reflex: true, kind: 'volley', y: 3, stanceY: 3.2 }));
      expect(block.why).toBe('reflex');
      expect(Math.abs(block.aim)).toBeLessThanOrEqual(0.3);
      expect(block.power).toBeLessThan(LEVELS.medium.power);
      expect(block.scatter ?? 1).toBeGreaterThan(1);
      expect(block.lob).toBe(false);
    }
  });

  it('con una pelota que le exigiste va por todo solo quien pega fuerte y no lee el juego, y esa es la que se va; con una cómoda, nunca', () => {
    const gambles = (level: typeof LEVELS.medium, demand = 0.8): number => {
      const { choose, demanding, match, me } = rival(level);
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const tough = plan(0.05, { z: 0.3 });
        demanding(tough, demand);
        const shot = choose(match, me, tough);
        if (shot.why === 'gamble') {
          n++;
          expect(shot.scatter ?? 1).toBeGreaterThan(1.5);
          expect(shot.lob).toBe(false);
        }
      }
      return n / 400;
    };
    const config = createConfig();
    const romina = gambles({ ...LEVELS.medium, ...config.rivals.romina });
    const chela = gambles({ ...LEVELS.medium, ...config.rivals.chela });
    expect(romina).toBeGreaterThan(0.1);
    // Chela always lobs when pressed (her trait), and reads the game anyway.
    expect(chela).toBe(0);
    // A comfortable ball is never the one Romina throws away.
    expect(gambles({ ...LEVELS.medium, ...config.rivals.romina }, 0)).toBe(0);
  });

  it('lee antes la pelota de quien está en apuros, y la chiquita lo agarra a contrapié si está atrás', () => {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 3,
      teams: [{ name: 'A', players: [person()] }, { name: 'B', players: [{ ...pairEntry(config, 'hard', 4), reading: 1 }] }],
    });
    const setReads = (match as unknown as { setReads: (team: 0 | 1, by: Player, kind: string, quality: string, pressure: number) => void }).setReads.bind(match);
    const me = match.players[1]!;
    const by = match.players[0]!;
    me.y = 7.4;
    setReads(1, by, 'drive', 'good', 0);
    expect(me.read).toBeCloseTo(me.reaction);
    // The answer of somebody in trouble: a defensive ball, seen coming.
    setReads(1, by, 'drive', 'good', 0.7);
    expect(me.read).toBeLessThan(me.reaction * 0.8);
    // A chiquita while it waits at the back: caught out.
    setReads(1, by, 'drop', 'good', 0);
    expect(me.read).toBeGreaterThan(me.reaction * 1.4);
    // At the net a chiquita is just another ball.
    me.y = 3.2;
    setReads(1, by, 'drop', 'good', 0);
    expect(me.read).toBeCloseTo(me.reaction);
    // A clean strike hides where it is going.
    setReads(1, by, 'drive', 'perfect', 0);
    expect(me.read).toBeGreaterThan(me.reaction);
  });
});

describe('actitudes', () => {
  /** Every ball the partner took from the person in a few matches, with what it said before hitting it. */
  function steals(attitude: Attitude, mate: RivalId = 'beto') {
    let stolen = 0;
    let warned = 0;
    let netTime = 0;
    let live = 0;
    let ups = 0;
    for (const seed of [81, 82, 83]) {
      const match = doubles({ seed, side: 'reves', real: true, who: 'positional', mate, attitude });
      const partner = match.players[0]!;
      let why = match.pairs[0].why;
      let said: string | null = null;
      playWatched(match, () => {
        for (const event of match.events) {
          if (event.type === 'hit' && event.kind !== 'serve' && event.player === partner.id && why === 'steal') {
            stolen++;
            if (said === 'mine') warned++;
          }
        }
        why = match.pairs[0].why;
        said = partner.callTraj === (match.trajectory?.id ?? -2) ? partner.call : null;
        if (partner.call === 'up' && partner.callAt === match.time) ups++;
        if (match.phase === 'rally' && match.rally.live) {
          live++;
          if (Math.abs(partner.y) < 5) netTime++;
        }
      });
    }
    return { stolen, warned, net: netTime / live, ups };
  }

  it('la agresiva a veces te pide la pelota, y siempre avisa antes; la equilibrada y la pasiva nunca', () => {
    const aggressive = steals('aggressive');
    expect(aggressive.stolen).toBeGreaterThan(2);
    expect(aggressive.warned).toBe(aggressive.stolen);
    expect(steals('balanced').stolen).toBe(0);
    expect(steals('passive').stolen).toBe(0);
  });

  it('la agresiva sube más y te llama a la red; la pasiva sube menos', () => {
    const aggressive = steals('aggressive', 'chela');
    const passive = steals('passive', 'chela');
    expect(aggressive.net).toBeGreaterThan(passive.net + 0.05);
    expect(aggressive.ups).toBeGreaterThan(passive.ups);
  });

  it('cada actitud sigue a la persona a su manera: la agresiva sube antes y baja después; la pasiva, al revés', () => {
    const me = createPlayer(0, 0, 0, person());
    me.x = 2;
    const goes = (attitude: Attitude, depth: number): string => {
      const state = createPairState();
      me.y = -depth;
      followPerson(state, me, 0, ATTITUDE[attitude]);
      return state.home;
    };
    // At 5.5 m from the net, half way in: the aggressive partner is already up.
    expect(goes('aggressive', 5.5)).toBe('net');
    expect(goes('balanced', 5.5)).toBe('back');
    // At 4.5 m the balanced one goes up; the passive one waits until you are really there.
    expect(goes('balanced', 4.5)).toBe('net');
    expect(goes('passive', 4.5)).toBe('back');
    expect(goes('passive', 3.5)).toBe('net');
    // How long you have to stay at the back for it to drop back too.
    expect(ATTITUDE.aggressive.dropAfter).toBeGreaterThan(ATTITUDE.balanced.dropAfter);
    expect(ATTITUDE.passive.dropAfter).toBeLessThan(ATTITUDE.balanced.dropAfter);
  });

  it('la actitud no cambia al personaje: las mismas piernas, las mismas manos, el mismo gesto', () => {
    const config = createConfig();
    for (const id of ['beto', 'romina', 'chela'] as const) {
      const level = config.rivals[id];
      for (const attitude of ATTITUDES) {
        const changed = withAttitude(level, attitude);
        for (const key of ['speedFactor', 'reaction', 'timingSigma', 'errorScale', 'power', 'wallBias', 'tellLead', 'angle'] as const) {
          expect(changed[key], `${id} ${attitude} ${key}`).toBe(level[key]);
        }
      }
      expect(withAttitude(level, 'aggressive').netRush).toBeGreaterThan(withAttitude(level, 'passive').netRush);
    }
    // One against one there is no attitude: the rivals are as they always were.
    for (const id of ['beto', 'romina', 'chela'] as const) {
      expect(config.rivals[id].steal).toBe(0);
      expect(toAILevel(CAST[id])).toEqual(config.rivals[id]);
    }
  });

  it('cada uno tiene la suya, y el compañero recuerda la que le pediste', () => {
    expect(CAST.beto.attitude).toBe('balanced');
    expect(CAST.romina.attitude).toBe('aggressive');
    expect(CAST.chela.attitude).toBe('passive');
    const settings = defaultSettings(false);
    expect(partnerAttitude(settings, 'romina')).toBe('aggressive');
    settings.attitudes.romina = 'passive';
    expect(partnerAttitude(settings, 'romina')).toBe('passive');
    expect(partnerAttitude(settings, 'beto')).toBe('balanced');
    // What was saved is kept if it still makes sense.
    const read = readSettings({ attitudes: { romina: 'passive', beto: 'nope', nadie: 'aggressive' } }, false);
    expect(read.attitudes).toEqual({ romina: 'passive' });
    expect(attitudeFrom('agresiva')).toBe('aggressive');
    expect(attitudeFrom('Pasivo')).toBe('passive');
    expect(attitudeFrom('equilibrada')).toBe('balanced');
    expect(attitudeFrom('xyz')).toBeNull();
  });

  it('con la misma semilla, el partido con una compañera agresiva es idéntico', () => {
    const record = (): string[] => {
      const log: string[] = [];
      const match = doubles({ seed: 91, side: 'reves', real: true, who: 'positional', mate: 'romina', attitude: 'aggressive' });
      playWatched(match, () => {
        for (const event of match.events) {
          if (event.type === 'hit') log.push(`${event.player}:${event.kind}:${event.x.toFixed(4)}:${event.speed.toFixed(4)}:${event.why ?? ''}`);
          else if (event.type === 'point') log.push(`point:${event.winner}:${event.reason}`);
        }
      });
      return log;
    };
    expect(record()).toEqual(record());
  });
});
