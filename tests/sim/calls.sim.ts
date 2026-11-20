import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { GameConfig, RivalId } from '../../src/config';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { closestPass, MIDDLE_BAND, PLAIN, type CallKind } from '../../src/sim/pair';
import type { Player } from '../../src/sim/player';
import { humanEntry, pairEntry, partnerEntry, SKILLS, testConfig, withTactics } from '../helpers';

/**
 * Report on the calls of doubles: `npx vitest run --config vitest.sim.config.ts calls`.
 *
 * How many of the balls a pair plays carry a call, of which kind and why,
 * for the person's partner and for the pair across the net. A call is what a
 * player tells its partner (`Player.call`); the body shows it only when whose
 * the ball is does not show by itself, or when the ball changes hands
 * (`Player.callShown`, `PairState.unclear`). What is said and not shown is
 * counted apart, and so is how often it says something a person who plays its
 * side and the middle by the rule would not have known.
 *
 * And whether that is enough: a person who takes in only what its partner
 * shows (and needs a moment to read it), against one who hears every word.
 *
 * Nothing is asserted.
 *
 *   CALLS_MATCHES=10  quicker, noisier (20 by default)
 *   CALLS_JSON=path   also writes the numbers to a file
 *   SIM_REACH=real    everybody with the reach of a real person
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.CALLS_MATCHES ?? 20);
const JSON_PATH = env?.CALLS_JSON;

const KINDS: CallKind[] = ['mine', 'yours', 'switch', 'up', 'back'];
const KIND_NAME: Record<CallKind, string> = { mine: '¡mía!', yours: '¡tuya!', switch: '¡voy!', up: '¡arriba!', back: '¡atrás!' };

/** Why it was said, as far as can be told from the pair at that moment. */
type Reason = 'middle' | 'cover' | 'steal' | 'handoff' | 'doubt' | 'switch' | 'up' | 'back';
const REASON_NAME: Record<Reason, string> = {
  middle: 'de quién es (el medio)',
  cover: 'la toma porque el otro no llega',
  steal: 'robo de la agresiva',
  handoff: 'no llega: te la deja',
  doubt: 'dudan',
  switch: 'cruza por un globo',
  up: 'arriba',
  back: 'atrás',
};

interface Side {
  /** Balls struck at this pair in a rally (serves aside), and how many of them carried a call of each kind, said and shown. */
  balls: number;
  saidOn: Record<CallKind, number>;
  shownOn: Record<CallKind, number>;
  anySaid: number;
  anyShown: number;
  /** Calls made, by kind and why, said and shown. */
  said: Record<string, number>;
  shown: Record<string, number>;
  /** Calls of the person's partner that were not shown and told the person something the rule did not: news it missed. */
  hiddenNews: number;
  hidden: number;
  /** Balls taken from a partner who was not getting there, and how many of them came plainly closer to the one who took it. */
  covers: number;
  plainCovers: number;
}

const emptyKinds = (): Record<CallKind, number> => ({ mine: 0, yours: 0, switch: 0, up: 0, back: 0 });
const emptySide = (): Side => ({ balls: 0, saidOn: emptyKinds(), shownOn: emptyKinds(), anySaid: 0, anyShown: 0, said: {}, shown: {}, hiddenNews: 0, hidden: 0, covers: 0, plainCovers: 0 });

/** Whether a call is shown with the body. Before calls were sorted, every one was. */
const shownOf = (player: Player): boolean => (player as Player & { callShown?: boolean }).callShown ?? true;

function reasonOf(match: Match, player: Player, kind: CallKind): Reason {
  const team = player.team;
  const pair = match.pairs[team];
  const traj = match.trajectory?.id ?? -2;
  const mine = match.assigned[team] === player.id;
  switch (kind) {
    case 'mine':
      return pair.why === 'steal' && mine ? 'steal' : pair.why === 'cover' && mine ? 'cover' : 'middle';
    case 'yours':
      if (pair.doubted === traj) return 'doubt';
      return pair.why === 'cover' && !mine ? 'handoff' : 'middle';
    default:
      return kind;
  }
}

/**
 * What a person who plays by the rule takes the ball on its way to be, from
 * where both of them are: its side of the pair, and the middle the forehand's
 * (see `isMine` in tests/helpers.ts). Null when it has no idea yet.
 */
function ruleSaysPersons(person: Player, mate: Player): boolean | null {
  const guide = person.guide ?? person.plan;
  if (!guide) return null;
  const dir = person.team === 0 ? 1 : -1;
  const mid = (person.x + mate.x) / 2;
  const off = guide.x - mid;
  if (Math.abs(off) <= MIDDLE_BAND) {
    const forehand = (who: Player): boolean => (mid - who.x) * who.hand * dir > 0;
    if (forehand(person) !== forehand(mate)) return forehand(person);
    return Math.abs(person.y) <= Math.abs(mate.y);
  }
  return Math.sign(off) === Math.sign(person.x - mid || (person.index === 0 ? dir : -dir));
}

type Setup = (config: GameConfig, seed: number) => [PlayerEntry[], PlayerEntry[]];

function play(setup: Setup): [Side, Side] {
  const sides: [Side, Side] = [emptySide(), emptySide()];
  for (let i = 0; i < MATCHES; i++) {
    const config = testConfig();
    const [near, far] = setup(config, 2000 + i * 7);
    const match = new Match({
      config,
      seed: 900 + i,
      firstServer: i % 2 === 0 ? 0 : 1,
      teams: [
        { name: 'A', players: near },
        { name: 'B', players: far },
      ],
    });
    // From one hit to the next: what each pair said meanwhile, and whether the ball was on its way to it.
    const said = [new Set<CallKind>(), new Set<CallKind>()];
    const shown = [new Set<CallKind>(), new Set<CallKind>()];
    const receiving = [false, false];
    const close = (): void => {
      for (const team of [0, 1] as const) {
        const side = sides[team];
        if (receiving[team]) {
          for (const kind of said[team]!) side.saidOn[kind]++;
          for (const kind of shown[team]!) side.shownOn[kind]++;
          if (said[team]!.size) side.anySaid++;
          if (shown[team]!.size) side.anyShown++;
        }
        said[team]!.clear();
        shown[team]!.clear();
        receiving[team] = false;
      }
    };
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      for (const event of match.events) {
        if (event.type === 'hit') {
          close();
          if (event.kind !== 'serve') {
            const team = event.team === 0 ? 1 : 0;
            sides[team].balls++;
            receiving[team] = true;
          }
        } else if (event.type === 'point') {
          close();
        }
      }
      match.events.length = 0;
      for (const player of match.players) {
        if (!player.call || player.callAt !== match.time || player.isHuman) continue;
        const kind = player.call;
        const team = player.team;
        const side = sides[team];
        const visible = shownOf(player);
        const reason = reasonOf(match, player, kind);
        const key = `${kind} · ${REASON_NAME[reason]}`;
        if (reason === 'cover' && match.trajectory) {
          const mate = match.teams[team].find((other) => other !== player)!;
          const highest = match.config.player.maxContactZ;
          const near = closestPass(match.trajectory, player, match.time, highest);
          const far = closestPass(match.trajectory, mate, match.time, highest);
          side.covers++;
          if (far - near > PLAIN * Math.hypot(player.x - mate.x, player.y - mate.y)) side.plainCovers++;
        }
        side.said[key] = (side.said[key] ?? 0) + 1;
        if (visible) side.shown[key] = (side.shown[key] ?? 0) + 1;
        said[team]!.add(kind);
        if (visible) shown[team]!.add(kind);
        // Next to a person: did a call it did not show tell the person anything the rule did not?
        const person = match.teams[team].find((other) => other.manual) ?? null;
        if (person && !visible && (kind === 'mine' || kind === 'yours')) {
          side.hidden++;
          const rule = ruleSaysPersons(person, player);
          if (rule !== null && rule !== (kind === 'yours')) side.hiddenNews++;
        }
      }
    }
  }
  return sides;
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${((100 * part) / whole).toFixed(1)} %` : '—');

function describe2(title: string, sides: [Side, Side], names: [string, string]): string[] {
  const out = [`\n${title} (${MATCHES} partidos)`];
  for (const team of [0, 1] as const) {
    const side = sides[team];
    out.push(`  ${names[team]}: ${side.balls} pelotas recibidas`);
    out.push(`    pelotas que recibe con alguna seña: dicha ${pct(side.anySaid, side.balls)}, mostrada ${pct(side.anyShown, side.balls)}`);
    const count = (of: Record<string, number>, kind: CallKind): number =>
      Object.entries(of).reduce((sum, [key, n]) => sum + (key.startsWith(`${kind} `) ? n : 0), 0);
    for (const kind of KINDS) {
      const n = count(side.said, kind);
      if (!n) continue;
      const per100 = (value: number): string => ((100 * value) / Math.max(1, side.balls)).toFixed(1);
      out.push(
        `    ${KIND_NAME[kind].padEnd(9)} en ${pct(side.saidOn[kind], side.balls).padStart(7)} de las que recibe (mostrada ${pct(side.shownOn[kind], side.balls).padStart(7)}); ${per100(n).padStart(5)} por cada 100 pelotas (mostradas ${per100(count(side.shown, kind))})`,
      );
    }
    const keys = Object.keys(side.said).sort((a, b) => side.said[b]! - side.said[a]!);
    for (const key of keys) {
      out.push(`      ${key.padEnd(44)} ${String(side.said[key]).padStart(5)} dichas, ${String(side.shown[key] ?? 0).padStart(5)} mostradas`);
    }
    if (side.covers) out.push(`    la toma porque el otro no llega: ${side.covers}, y en ${side.plainCovers} (${pct(side.plainCovers, side.covers)}) la pelota le pasa claramente más cerca`);
    if (side.hidden) out.push(`    no mostradas que le decían a la persona algo distinto de la regla del lado y el medio: ${side.hiddenNews} de ${side.hidden} (${pct(side.hiddenNews, side.hidden)})`);
  }
  return out;
}

/** Ways a point ends that the last hitter won: the other side did not get there. */
const WON_BY_HITTER = new Set(['doubleBounce', 'overNet', 'outAfterBounce']);

interface Together {
  balls: number;
  points: number;
  won: number;
  /** Balls on their way to the pair that both of them swung at, and that neither of them swung at and lost the point. */
  both: number;
  neither: number;
}

/**
 * How the pair with the person in it (the near one) gets on: the share of
 * points it wins, the balls both of them swing at and the ones neither of
 * them goes for, that lose the point.
 */
function together(setup: Setup): Together {
  const out: Together = { balls: 0, points: 0, won: 0, both: 0, neither: 0 };
  for (let i = 0; i < MATCHES; i++) {
    const config = testConfig();
    const [near, far] = setup(config, 2000 + i * 7);
    const match = new Match({ config, seed: 900 + i, firstServer: i % 2 === 0 ? 0 : 1, teams: [{ name: 'A', players: near }, { name: 'B', players: far }] });
    const swung = new Set<number>();
    let receiving = false;
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      for (const event of match.events) {
        if ((event.type === 'hit' || event.type === 'whiff') && receiving && match.players[event.player]!.team === 0) swung.add(event.player);
        if (event.type === 'hit') {
          if (receiving && swung.size > 1) out.both++;
          swung.clear();
          receiving = event.team === 1 && event.kind !== 'serve';
          if (receiving) out.balls++;
        } else if (event.type === 'point') {
          out.points++;
          if (event.winner === 0) out.won++;
          else if (receiving && swung.size === 0 && WON_BY_HITTER.has(event.reason)) out.neither++;
          if (receiving && swung.size > 1) out.both++;
          swung.clear();
          receiving = false;
        }
      }
      match.events.length = 0;
    }
  }
  return out;
}

const collected: Record<string, unknown> = {};

function keep(name: string, value: unknown): void {
  collected[name] = value;
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify(collected, null, 1));
}

describe('señas de dobles', () => {
  it('cuántas pelotas llevan seña, de qué clase y por qué', () => {
    const out: string[] = [];
    const person = (mate: RivalId, rivals: [RivalId, RivalId], tactics: number): Setup => (config, seed) => {
      const me = humanEntry(seed, withTactics(SKILLS.average, tactics));
      const partner = partnerEntry(config, mate, seed + 1);
      // The person on the left (revés), as the game has it by default.
      return [[partner, me], [pairEntry(config, rivals[0], seed + 2), pairEntry(config, rivals[1], seed + 3)]];
    };
    const setups: Array<[string, string, Setup, [string, string]]> = [
      ['default', 'Partida de dobles por defecto: vos (promedio, posicional, revés) y Beto contra Romina y Chela', person('beto', ['romina', 'chela'], 1), ['Tu pareja (Beto)', 'Rivales (Romina y Chela)']],
      ['sprinter', 'Vos sin táctica (corrés a todas) y Beto contra Romina y Chela', person('beto', ['romina', 'chela'], 0), ['Tu pareja (Beto)', 'Rivales (Romina y Chela)']],
      ['romina', 'Vos (posicional) y Romina, agresiva, contra Beto y Chela', person('romina', ['beto', 'chela'], 1), ['Tu pareja (Romina)', 'Rivales (Beto y Chela)']],
      ['chela', 'Vos (posicional) y Chela, pasiva, contra Beto y Romina', person('chela', ['beto', 'romina'], 1), ['Tu pareja (Chela)', 'Rivales (Beto y Romina)']],
    ];
    for (const [name, title, setup, names] of setups) {
      const sides = play(setup);
      keep(name, sides);
      out.push(...describe2(title, sides, names));
    }
    console.log(out.join('\n'));
  });

  it('¿lo que se dice sin mostrarlo le hace falta a quien juega sin sonido?', () => {
    const out: string[] = [`\nUna persona promedio, posicional, al revés, que se entera de todo lo que dice su compañero o solo de lo que muestra (${MATCHES} partidos):`];
    const lineups: Array<[RivalId, [RivalId, RivalId]]> = [
      ['beto', ['romina', 'chela']],
      ['romina', ['beto', 'chela']],
      ['chela', ['beto', 'romina']],
    ];
    for (const [mate, rivals] of lineups) {
      const cells: string[] = [];
      for (const hears of ['words', 'signs'] as const) {
        const result = together((config, seed) => {
          const me = humanEntry(seed, { ...withTactics(SKILLS.average, 1), hears });
          return [[partnerEntry(config, mate, seed + 1), me], [pairEntry(config, rivals[0], seed + 2), pairEntry(config, rivals[1], seed + 3)]];
        });
        keep(`${mate}-${hears}`, result);
        const per100 = (value: number): string => ((100 * value) / Math.max(1, result.balls)).toFixed(1);
        cells.push(`${hears === 'words' ? 'todo' : 'solo señas'}: gana ${pct(result.won, result.points)} de los puntos; van los dos a ${per100(result.both)} y ninguno a ${per100(result.neither)} de cada 100`);
      }
      out.push(`  con ${mate}: ${cells.join('   |   ')}`);
    }
    console.log(out.join('\n'));
  });
});
