import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { GameConfig, RivalId } from '../../src/config';
import { Match, type PlayerEntry } from '../../src/sim/match';
import type { Player } from '../../src/sim/player';
import { aiEntry, humanEntry, partnerEntry, SKILLS, testConfig, withTactics, type SkillName } from '../helpers';

/**
 * Doubles report: `npm run sim` (or `npx vitest run --config vitest.sim.config.ts doubles`).
 *
 * Does the position matter? What it measures, against the targets of
 * docs/dobles.md:
 *
 *   - who wins the point when one pair has the net and the other is at the back;
 *   - how much a hole costs: a pair split in two (one at the net, one at the
 *     back) or somebody waiting half way, against a pair that is together;
 *   - how long each pair is together (both at the net or both at the back);
 *   - how much playing positionally pays, with the same hands: a person who
 *     plays its side of the pair, goes up and down with its partner and plays
 *     the ball where the other pair is not, against one that chases every
 *     ball it can get to and stays at the back;
 *   - how long the points are.
 *
 * Nothing is asserted. What falls outside a target is printed as a warning.
 *
 *   SIM_MATCHES=10   quicker, noisier
 *   SIM_JSON=path    also writes the numbers to a file
 *   SIM_REACH=real   everybody with the reach of a real person (see `realReach` in src/config.ts)
 *   SIM_SKILLS=average  only some hands
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 30);
const JSON_PATH = env?.SIM_JSON;
const SKILL_LIST = (env?.SIM_SKILLS ?? 'beginner,average,expert').split(',') as SkillName[];
/** Who plays with the person and who against: partner, then the two rivals. */
const LINEUP = (env?.SIM_LINEUP ?? 'beto,romina,chela').split(',') as [RivalId, RivalId, RivalId];
/** The side the person plays: drive (right, the default) or revés (left, with the middle on its forehand). */
const REVES = env?.SIM_SIDE === 'reves';

/** Closer to the net than this, a player is at the net; further than `BACK`, at the back; in between, half way. */
const NET = 5;
const BACK = 6.5;
/** Ways a point ends that the last hitter won: the other side did not get there. */
const WON_BY_HITTER = new Set(['doubleBounce', 'overNet', 'outAfterBounce']);

type Shape = 'together' | 'split' | 'halfway';
const SHAPES: Shape[] = ['together', 'split', 'halfway'];
const SHAPE_NAME: Record<Shape, string> = { together: 'juntos', split: 'partidos', halfway: 'alguien en tierra de nadie' };

function zoneOf(player: Player): 'net' | 'mid' | 'back' {
  const depth = Math.abs(player.y);
  return depth < NET ? 'net' : depth > BACK ? 'back' : 'mid';
}

/** How a pair stands: together (both at the net or both at the back), split, or somebody half way. */
function shapeOf(pair: readonly Player[]): Shape {
  if (pair.length < 2) return 'together';
  const a = zoneOf(pair[0]!);
  const b = zoneOf(pair[1]!);
  if (a === 'mid' || b === 'mid') return 'halfway';
  return a === b ? 'together' : 'split';
}

const bothAt = (pair: readonly Player[], zone: 'net' | 'back'): boolean => pair.every((player) => zoneOf(player) === zone);

interface Faced {
  /** Balls faced in this shape, and how many of them lost the point at once (on that ball or the next). */
  n: number;
  lost: number;
}

interface Stats {
  title: string;
  matches: number;
  wins: [number, number];
  pointsWon: [number, number];
  lengths: number[];
  seconds: number[];
  byError: number;
  /** Seconds of live ball each pair spent in each shape. */
  shapeTime: [Record<Shape, number>, Record<Shape, number>];
  /** Balls each pair faced in each shape. */
  faced: [Record<Shape, Faced>, Record<Shape, Faced>];
  /** Points that ended with one pair at the net and the other at the back, and how many the net pair won. */
  netVsBack: number;
  netVsBackWonByNet: number;
  /** Points lost by a pair on a ball none of the two touched, and how many of those went through the middle of the pair. */
  untouched: [number, number];
  untouchedMiddle: [number, number];
  hits: [number, number];
  hitsAtNet: [number, number];
  kinds: Record<string, number>;
  /** Seconds of live ball with both pairs at the back, one of them at the net, both at the net, or anything else. */
  phases: Record<string, number>;
  winningShot: Record<string, number>;
  missedShot: Record<string, number>;
  stalled: number;
}

type Setup = (config: GameConfig, seed: number) => [PlayerEntry[], PlayerEntry[]];

const emptyShapes = (): Record<Shape, number> => ({ together: 0, split: 0, halfway: 0 });
const emptyFaced = (): Record<Shape, Faced> => ({ together: { n: 0, lost: 0 }, split: { n: 0, lost: 0 }, halfway: { n: 0, lost: 0 } });

function play(title: string, setup: Setup): Stats {
  const stats: Stats = {
    title,
    matches: MATCHES,
    wins: [0, 0],
    pointsWon: [0, 0],
    lengths: [],
    seconds: [],
    byError: 0,
    shapeTime: [emptyShapes(), emptyShapes()],
    faced: [emptyFaced(), emptyFaced()],
    netVsBack: 0,
    netVsBackWonByNet: 0,
    untouched: [0, 0],
    untouchedMiddle: [0, 0],
    hits: [0, 0],
    hitsAtNet: [0, 0],
    kinds: {},
    phases: {},
    winningShot: {},
    missedShot: {},
    stalled: 0,
  };

  for (let i = 0; i < MATCHES; i++) {
    const config = testConfig();
    const [near, far] = setup(config, 1000 + i * 7);
    const match = new Match({
      config,
      seed: 500 + i,
      firstServer: i % 2 === 0 ? 0 : 1,
      teams: [
        { name: 'A', players: near },
        { name: 'B', players: far },
      ],
    });
    // The balls struck at each pair in this point: its shape then, and how many touches it had made before.
    let facing: Array<{ team: 0 | 1; shape: Shape; touches: number }> = [];
    const touches: [number, number] = [0, 0];
    let shots = 0;
    let startedAt = 0;
    let lastShapes: [Shape, Shape] = ['together', 'together'];
    let lastNet: [boolean, boolean] = [false, false];
    let lastBack: [boolean, boolean] = [false, false];
    /** Where the last ball bounced on the side that had to play it, across the court. */
    let bounceX: number | null = null;
    let lastHitter: 0 | 1 = 0;
    let lastKind = 'serve';
    let lastMid = 0;
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      if (match.phase === 'rally' && match.rally.live) {
        for (const team of [0, 1] as const) stats.shapeTime[team][shapeOf(match.teams[team])] += 1 / 120;
        const net = [bothAt(match.teams[0], 'net'), bothAt(match.teams[1], 'net')];
        const back = [bothAt(match.teams[0], 'back'), bothAt(match.teams[1], 'back')];
        const phase =
          back[0] && back[1] ? 'las dos al fondo' : net[0] && net[1] ? 'las dos en la red' : (net[0] && back[1]) || (net[1] && back[0]) ? 'red contra fondo' : 'en movimiento';
        stats.phases[phase] = (stats.phases[phase] ?? 0) + 1 / 120;
      }
      for (const event of match.events) {
        if (event.type === 'hit') {
          if (shots === 0) startedAt = match.time;
          shots++;
          const receiving = event.team === 0 ? 1 : 0;
          touches[event.team]++;
          const me = match.players[event.player]!;
          if (event.kind !== 'serve') {
            stats.hits[event.team]++;
            if (Math.abs(me.y) < NET) stats.hitsAtNet[event.team]++;
            stats.kinds[event.kind] = (stats.kinds[event.kind] ?? 0) + 1;
            facing.push({ team: receiving, shape: shapeOf(match.teams[receiving]), touches: touches[receiving] });
          }
          lastShapes = [shapeOf(match.teams[0]), shapeOf(match.teams[1])];
          lastNet = [bothAt(match.teams[0], 'net'), bothAt(match.teams[1], 'net')];
          lastBack = [bothAt(match.teams[0], 'back'), bothAt(match.teams[1], 'back')];
          lastHitter = event.team;
          lastKind = event.kind;
          const pair = match.teams[receiving];
          lastMid = pair.length > 1 ? (pair[0]!.x + pair[1]!.x) / 2 : pair[0]!.x;
          bounceX = null;
        } else if (event.type === 'bounce') {
          if (bounceX === null) bounceX = event.x;
        } else if (event.type === 'match') {
          stats.wins[event.winner]++;
        } else if (event.type === 'point') {
          if (shots === 0) continue;
          const loser = event.winner === 0 ? 1 : 0;
          stats.pointsWon[event.winner]++;
          stats.lengths.push(shots);
          stats.seconds.push(match.time - startedAt);
          if (!WON_BY_HITTER.has(event.reason)) {
            stats.byError++;
            stats.missedShot[lastKind] = (stats.missedShot[lastKind] ?? 0) + 1;
          } else {
            stats.winningShot[lastKind] = (stats.winningShot[lastKind] ?? 0) + 1;
          }
          // A ball nobody of the pair touched, and whether it went through the middle of it.
          if (WON_BY_HITTER.has(event.reason) && lastHitter === event.winner) {
            stats.untouched[loser]++;
            if (bounceX !== null && Math.abs(bounceX - lastMid) < 1.2) stats.untouchedMiddle[loser]++;
          }
          for (const ball of facing) {
            const entry = stats.faced[ball.team][ball.shape];
            entry.n++;
            // Lost on that ball or on the next one: the pair touched it at most once more.
            if (loser === ball.team && touches[ball.team] - ball.touches <= 1) entry.lost++;
          }
          for (const team of [0, 1] as const) {
            const other = team === 0 ? 1 : 0;
            if (lastNet[team] && lastBack[other]) {
              stats.netVsBack++;
              if (event.winner === team) stats.netVsBackWonByNet++;
            }
          }
          void lastShapes;
          facing = [];
          touches[0] = 0;
          touches[1] = 0;
          shots = 0;
        } else if (event.type === 'fault' || event.type === 'let') {
          facing = [];
          touches[0] = 0;
          touches[1] = 0;
          shots = 0;
        }
      }
      match.events.length = 0;
    }
    if (match.phase !== 'matchOver') stats.stalled++;
  }
  stats.lengths.sort((a, b) => a - b);
  stats.seconds.sort((a, b) => a - b);
  return stats;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number => sum(xs) / (xs.length || 1);
const quantile = (xs: readonly number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const ratio = (a: number, b: number): number => (b ? a / b : 0);
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '-');
const asPct = (value: number): string => `${Math.round(value * 100)}%`;

function top(counts: Record<string, number>, n = 8): string {
  const total = sum(Object.values(counts)) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => `${key} ${Math.round((value / total) * 100)}%`)
    .join(', ');
}

/** The numbers of the targets, for one pairing. */
function indicators(stats: Stats): Record<string, number> {
  const points = stats.lengths.length;
  const together = (team: 0 | 1): number => ratio(stats.shapeTime[team].together, sum(Object.values(stats.shapeTime[team])));
  const lostWhen = (shape: Shape): number => {
    const n = stats.faced[0][shape].n + stats.faced[1][shape].n;
    return ratio(stats.faced[0][shape].lost + stats.faced[1][shape].lost, n);
  };
  return {
    pointsA: ratio(stats.pointsWon[0], sum(stats.pointsWon)),
    winsA: stats.wins[0],
    seconds: mean(stats.seconds),
    median: quantile(stats.lengths, 0.5),
    p90: quantile(stats.lengths, 0.9),
    netWins: ratio(stats.netVsBackWonByNet, stats.netVsBack),
    netVsBack: ratio(stats.netVsBack, points),
    togetherA: together(0),
    togetherB: together(1),
    lostTogether: lostWhen('together'),
    lostSplit: lostWhen('split'),
    lostHalfway: lostWhen('halfway'),
    holeCost: lostWhen('split') - lostWhen('together'),
    halfwayCost: lostWhen('halfway') - lostWhen('together'),
    netHits: ratio(sum(stats.hitsAtNet), sum(stats.hits)),
    errors: ratio(stats.byError, points),
    untouchedMiddleA: ratio(stats.untouchedMiddle[0], stats.pointsWon[1]),
  };
}

function describeStats(stats: Stats): string {
  const points = stats.lengths.length;
  const values = indicators(stats);
  const faced = (team: 0 | 1): string =>
    SHAPES.map((shape) => {
      const entry = stats.faced[team][shape];
      return `${SHAPE_NAME[shape]} ${pct(entry.n, sum(SHAPES.map((s) => stats.faced[team][s].n)))} (pierde en el acto ${pct(entry.lost, entry.n)})`;
    }).join(' | ');
  const time = (team: 0 | 1): string =>
    SHAPES.map((shape) => `${SHAPE_NAME[shape]} ${pct(stats.shapeTime[team][shape], sum(Object.values(stats.shapeTime[team])))}`).join(', ');
  return [
    `\n=== ${stats.title} (${stats.matches} partidos, ${points} puntos) ===`,
    `partidos        A ${stats.wins[0]} - B ${stats.wins[1]}   puntos A ${asPct(values.pointsA!)}`,
    `golpes/punto    media ${mean(stats.lengths).toFixed(1)}  mediana ${values.median}  p90 ${values.p90}   seg/punto media ${values.seconds!.toFixed(1)}  mediana ${quantile(stats.seconds, 0.5).toFixed(1)}  p90 ${quantile(stats.seconds, 0.9).toFixed(1)}`,
    `terminan en error de quien pega ${asPct(values.errors!)}   sin terminar ${stats.stalled}`,
    `red contra fondo al final ${pct(stats.netVsBack, points)} de los puntos, y los gana la red ${pct(stats.netVsBackWonByNet, stats.netVsBack)}`,
    `tiempo de pelota viva   A: ${time(0)}`,
    `                        B: ${time(1)}`,
    `pelotas recibidas       A: ${faced(0)}`,
    `                        B: ${faced(1)}`,
    `el hueco cuesta         partidos ${asPct(values.lostSplit!)} vs juntos ${asPct(values.lostTogether!)} (${Math.round(values.holeCost! * 100)} pp); tierra de nadie ${asPct(values.lostHalfway!)} (${Math.round(values.halfwayCost! * 100)} pp)`,
    `nadie la tocó           A ${stats.untouched[0]} (por el medio ${stats.untouchedMiddle[0]})   B ${stats.untouched[1]} (por el medio ${stats.untouchedMiddle[1]})`,
    `desde la red    ${asPct(values.netHits!)}   golpes ${top(stats.kinds)}`,
    `fases           ${top(stats.phases)}`,
    `golpe que gana  ${top(stats.winningShot)}   golpe errado ${top(stats.missedShot)}`,
  ].join('\n');
}

interface Target {
  key: string;
  label: string;
  min: number;
  max: number;
  show: (value: number) => string;
}

const asNumber = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const asPp = (value: number): string => `${Math.round(value * 100)} pp`;

/** docs/dobles.md, "Cómo se mide". */
const TARGETS: Target[] = [
  { key: 'netWins', label: 'red contra fondo: gana la red', min: 0.6, max: 1, show: asPct },
  { key: 'holeCost', label: 'el hueco cuesta (partidos − juntos)', min: 0.1, max: 1, show: asPp },
  { key: 'togetherB', label: 'pareja rival junta (tiempo)', min: 0.75, max: 1, show: asPct },
  { key: 'seconds', label: 'segundos de peloteo, media', min: 8, max: 14, show: asNumber },
];

function gates(stats: Stats): string[] {
  const values = indicators(stats);
  return TARGETS.map((target) => {
    const value = values[target.key] ?? 0;
    const inside = value >= target.min && value <= target.max;
    const range = target.max >= 1 && target.min > 0 && target.min < 1 ? `≥ ${target.show(target.min)}` : `${target.show(target.min)} a ${target.show(target.max)}`;
    return `  ${inside ? 'ok    ' : 'FUERA '} ${target.label.padEnd(38)} ${target.show(value).padStart(6)}   (meta ${range})`;
  });
}

const collected: Record<string, Record<string, number>> = {};

function keep(name: string, stats: Stats): void {
  collected[name] = indicators(stats);
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify(collected, null, 1));
}

describe('dobles', () => {
  it('cuatro IA medias: cómo se paran y quién gana desde dónde', () => {
    const out: string[] = [];
    const mirror = play('IA media y media contra IA media y media', (config, seed) => [
      [aiEntry(config, 'medium', seed), aiEntry(config, 'medium', seed + 1)],
      [aiEntry(config, 'medium', seed + 2), aiEntry(config, 'medium', seed + 3)],
    ]);
    keep('medium x4', mirror);
    out.push(describeStats(mirror), '\nMetas, cuatro IA medias:', ...gates(mirror));
    const cast = play('Beto y Chela contra Romina y Chela (cuatro IA)', (config, seed) => [
      [partnerEntry(config, 'beto', seed), partnerEntry(config, 'chela', seed + 1)],
      [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)],
    ]);
    keep('beto+chela vs romina+chela', cast);
    out.push(describeStats(cast));
    console.log(out.join('\n'));
  });

  it('vos y un compañero contra una pareja: ¿paga jugar posicional?', () => {
    const out: string[] = [];
    const [mate, rivalA, rivalB] = LINEUP;
    out.push(`
Vos (${REVES ? 'revés' : 'drive'}) y ${mate} contra ${rivalA} y ${rivalB}`);
    const person = (skill: SkillName, tactics: number): Setup => (config, seed) => {
      const me = humanEntry(seed, withTactics(SKILLS[skill], tactics));
      const partner = partnerEntry(config, mate, seed + 1);
      return [REVES ? [partner, me] : [me, partner], [aiEntry(config, rivalA, seed + 2), aiEntry(config, rivalB, seed + 3)]];
    };
    const cells: Array<{ skill: SkillName; plain: Stats; thinking: Stats }> = [];
    for (const skill of SKILL_LIST) {
      const plain = play(`persona ${skill} sin táctica (corre a todas) y ${mate}, contra ${rivalA} y ${rivalB}`, person(skill, 0));
      const thinking = play(`persona ${skill} posicional y ${mate}, contra ${rivalA} y ${rivalB}`, person(skill, 1));
      keep(`${skill} sin táctica`, plain);
      keep(`${skill} posicional`, thinking);
      cells.push({ skill, plain, thinking });
      if (skill === 'average' || SKILL_LIST.length === 1) {
        out.push(describeStats(plain), describeStats(thinking), '\nMetas, persona promedio posicional:', ...gates(thinking));
      }
    }
    out.push('\n¿Paga jugar posicional? Con las mismas manos:');
    for (const { skill, plain, thinking } of cells) {
      const a = indicators(plain);
      const b = indicators(thinking);
      const gap = Math.round((b.pointsA! - a.pointsA!) * 100);
      out.push(
        `  ${skill.padEnd(9)} puntos ${asPct(a.pointsA!)} → ${asPct(b.pointsA!)}  (${gap >= 0 ? '+' : ''}${gap} pp${gap < 15 ? ', FUERA: la meta es +15' : ''})   partidos ${a.winsA}/${MATCHES} → ${b.winsA}/${MATCHES}   seg/punto ${a.seconds!.toFixed(1)} → ${b.seconds!.toFixed(1)}   juntos ${asPct(a.togetherA!)} → ${asPct(b.togetherA!)}`,
      );
    }
    console.log(out.join('\n'));
  });
});
