import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { GameConfig, RivalId } from '../../src/config';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { aiEntry, humanEntry, SKILLS, testConfig, withTactics, type SkillName } from '../helpers';
import { addTotals, emptyTotals, ERROR_NAME, PairProbe, type ErrorCause, type ProbeTotals } from '../probe';

/**
 * Depth report: `npm run sim` (or `npx vitest run --config vitest.sim.config.ts depth`).
 *
 * How the points are played, not only who wins them: how long they are, how
 * they end, how much of the game happens at the net, what a lob does to
 * somebody at the net, what a difficult ball does to whoever gets it and how
 * much thinking pays with the same hands. The targets are the ones of
 * docs/profundidad.md (section 5.4).
 *
 * Nothing is asserted. What falls outside a target is printed as a warning:
 * it is here to tune the numbers in src/config.ts and src/characters.
 *
 *   SIM_MATCHES=10   quicker, noisier
 *   SIM_RIVAL=chela  only one rival
 *   SIM_JSON=path    also writes the numbers to a file
 *   SIM_TWEAK='{"rivals.chela.speedFactor":0.9,"rules.heatAfter":12}'
 *                    tries other numbers of the configuration without touching it
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 30);
const ONLY = env?.SIM_RIVAL;
const JSON_PATH = env?.SIM_JSON;
const TWEAK = JSON.parse(env?.SIM_TWEAK ?? '{}') as Record<string, number | boolean>;

/** A configuration with the numbers under trial, if any. */
function trialConfig(): GameConfig {
  const config = testConfig();
  for (const [path, value] of Object.entries(TWEAK)) {
    const keys = path.split('.');
    let at = config as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
    at[keys[keys.length - 1]!] = value;
  }
  return config;
}

/** Closer to the net than this, a player is "at the net". */
const NET = 5;
/**
 * A lob takes the net away when whoever was there lets it bounce. Taking it
 * in the air up to this far from the net (a bandeja) is keeping it.
 */
const HOLD = 7;
/** A ball this hard to play (0..1) is one somebody built. */
const BUILT = 0.6;
/** Ways a point ends that the last hitter won: the other one did not get there. */
const WON_BY_HITTER = new Set(['doubleBounce', 'overNet', 'outAfterBounce']);

const RIVALS: RivalId[] = ['beto', 'romina', 'chela'];
const HARDEST: RivalId = 'chela';

interface Hit {
  team: number;
  kind: string;
  quality: string;
  atNet: boolean;
  rivalAtNet: boolean;
  /** Taken in the air close enough to the net to still own it. */
  held: boolean;
  /** How hard the ball was for whoever hit it: what the shot before it left. */
  pressure: number;
}

interface Left {
  n: number;
  /** The one who got it missed with it. */
  error: number;
  /** The one who left it won the point. */
  won: number;
}

interface Stats {
  title: string;
  matches: number;
  wins: [number, number];
  pointsWon: [number, number];
  /** Points each side lost with its own racket, and the ones it lost in all. */
  lostByError: [number, number];
  lost: [number, number];
  lengths: number[];
  seconds: number[];
  byHitter: number;
  byError: number;
  winningShot: Record<string, number>;
  missedShot: Record<string, number>;
  hits: [number, number];
  hitsAtNet: [number, number];
  hitsInTheAir: number;
  endNetVsBack: number;
  endNetVsBackWonByNet: number;
  endBothNet: number;
  endBothBack: number;
  lobVsNet: number;
  lobVsNetRetreat: number;
  lobVsNetWon: number;
  /** What happened to the balls each shot left, by how hard they were. */
  left: Record<string, Left>;
  notReturned: number;
  byQuality: Record<string, { n: number; notReturned: number; won: number }>;
  kinds: Record<string, number>;
  heated: number;
  stalled: number;
  /** Why the points that ended in a mistake ended in one, by side (see tests/probe.ts). */
  human: ProbeTotals;
}

type Setup = (config: GameConfig, seed: number) => [PlayerEntry[], PlayerEntry[]];

function bucketOf(pressure: number): string {
  return pressure >= BUILT ? 'difícil' : pressure >= 0.3 ? 'incómoda' : 'cómoda';
}

function play(title: string, setup: Setup): Stats {
  const stats: Stats = {
    title,
    matches: MATCHES,
    wins: [0, 0],
    pointsWon: [0, 0],
    lostByError: [0, 0],
    lost: [0, 0],
    lengths: [],
    seconds: [],
    byHitter: 0,
    byError: 0,
    winningShot: {},
    missedShot: {},
    hits: [0, 0],
    hitsAtNet: [0, 0],
    hitsInTheAir: 0,
    endNetVsBack: 0,
    endNetVsBackWonByNet: 0,
    endBothNet: 0,
    endBothBack: 0,
    lobVsNet: 0,
    lobVsNetRetreat: 0,
    lobVsNetWon: 0,
    left: {},
    notReturned: 0,
    byQuality: {},
    kinds: {},
    heated: 0,
    stalled: 0,
    human: emptyTotals(),
  };

  for (let i = 0; i < MATCHES; i++) {
    const config = trialConfig();
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
    let rally: Hit[] = [];
    let startedAt = 0;
    const probe = new PairProbe(match);
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      probe.step();
      for (const event of match.events) {
        if (event.type === 'hit') {
          if (rally.length === 0) startedAt = match.time;
          const me = match.players[event.player]!;
          const rivals = match.teams[event.team === 0 ? 1 : 0];
          const atNet = Math.abs(me.y) < NET;
          rally.push({
            team: event.team,
            kind: event.kind,
            quality: event.quality,
            atNet,
            rivalAtNet: rivals.some((rival) => Math.abs(rival.y) < NET),
            held: event.volley && Math.abs(me.y) <= HOLD,
            pressure: (event as { pressure?: number }).pressure ?? 0,
          });
          if (event.kind !== 'serve') {
            stats.hits[event.team]++;
            if (atNet) stats.hitsAtNet[event.team]++;
            if (event.volley) stats.hitsInTheAir++;
            stats.kinds[event.kind] = (stats.kinds[event.kind] ?? 0) + 1;
          }
        } else if (event.type === 'match') {
          stats.wins[event.winner]++;
        } else if (event.type === 'point') {
          if (rally.length === 0) continue;
          const last = rally[rally.length - 1]!;
          const loser = event.winner === 0 ? 1 : 0;
          stats.pointsWon[event.winner]++;
          stats.lost[loser]++;
          stats.lengths.push(rally.length);
          stats.seconds.push(match.time - startedAt);
          if (rally.length > config.rules.heatAfter) stats.heated++;

          const hitterWon = WON_BY_HITTER.has(event.reason);
          if (hitterWon) {
            stats.byHitter++;
            stats.winningShot[last.kind] = (stats.winningShot[last.kind] ?? 0) + 1;
          } else {
            stats.byError++;
            stats.lostByError[loser]++;
            stats.missedShot[last.kind] = (stats.missedShot[last.kind] ?? 0) + 1;
          }

          if (last.atNet !== last.rivalAtNet) {
            stats.endNetVsBack++;
            const netTeam = last.atNet ? last.team : 1 - last.team;
            if (event.winner === netTeam) stats.endNetVsBackWonByNet++;
          } else if (last.atNet) stats.endBothNet++;
          else stats.endBothBack++;

          rally.forEach((hit, k) => {
            const next = rally[k + 1];
            const isLast = k === rally.length - 1;
            if (hit.kind !== 'serve' && !(isLast && !hitterWon)) {
              const quality = (stats.byQuality[hit.quality] ??= { n: 0, notReturned: 0, won: 0 });
              quality.n++;
              if (isLast) quality.notReturned++;
              if (event.winner === hit.team) quality.won++;
            }
            if (next) {
              // The ball this shot left is the one the next shot had to deal with.
              const left = (stats.left[bucketOf(next.pressure)] ??= { n: 0, error: 0, won: 0 });
              left.n++;
              if (k + 1 === rally.length - 1 && !hitterWon) left.error++;
              if (event.winner === hit.team) left.won++;
            } else if (hitterWon) {
              stats.notReturned++;
            }
            if (hit.kind === 'lob' && hit.rivalAtNet) {
              stats.lobVsNet++;
              if (!next || !next.held) stats.lobVsNetRetreat++;
              if (event.winner === hit.team) stats.lobVsNetWon++;
            }
          });
          rally = [];
        } else if (event.type === 'fault' || event.type === 'let') {
          rally = [];
        }
      }
      match.events.length = 0;
    }
    if (match.phase !== 'matchOver') stats.stalled++;
    addTotals(stats.human, probe.totals);
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

function top(counts: Record<string, number>, n = 6): string {
  const total = sum(Object.values(counts)) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => `${key} ${Math.round((value / total) * 100)}%`)
    .join(', ');
}

/** The numbers of the table of targets, for one pairing. */
function indicators(stats: Stats): Record<string, number> {
  const points = stats.lengths.length;
  const built = stats.left['difícil'];
  return {
    median: quantile(stats.lengths, 0.5),
    p90: quantile(stats.lengths, 0.9),
    seconds: mean(stats.seconds),
    errors: ratio(stats.byError, points),
    netHits: ratio(sum(stats.hitsAtNet), sum(stats.hits)),
    endAtNet: ratio(stats.endNetVsBack + stats.endBothNet, points),
    lobTakesNet: ratio(stats.lobVsNetRetreat, stats.lobVsNet),
    builtWins: built ? ratio(built.won, built.n) : 0,
    pointsA: ratio(stats.pointsWon[0], sum(stats.pointsWon)),
    winsA: stats.wins[0],
  };
}

function describeStats(stats: Stats): string {
  const points = stats.lengths.length;
  const lengths = stats.lengths;
  const seconds = stats.seconds;
  const left = ['cómoda', 'incómoda', 'difícil']
    .map((name) => {
      const entry = stats.left[name];
      return entry ? `${name} n=${entry.n} la erra ${pct(entry.error, entry.n)}, gana quien la dejó ${pct(entry.won, entry.n)}` : `${name} n=0`;
    })
    .join(' | ');
  return [
    `\n=== ${stats.title} (${stats.matches} partidos, ${points} puntos) ===`,
    `partidos        A ${stats.wins[0]} - B ${stats.wins[1]}   puntos A ${pct(stats.pointsWon[0], sum(stats.pointsWon))}`,
    `golpes/punto    media ${mean(lengths).toFixed(1)}  mediana ${quantile(lengths, 0.5)}  p75 ${quantile(lengths, 0.75)}  p90 ${quantile(lengths, 0.9)}  máx ${lengths[lengths.length - 1] ?? 0}`,
    `seg/punto       media ${mean(seconds).toFixed(1)}  mediana ${quantile(seconds, 0.5).toFixed(1)}  p90 ${quantile(seconds, 0.9).toFixed(1)}  máx ${(seconds[seconds.length - 1] ?? 0).toFixed(0)}`,
    `terminan        el otro no llega ${pct(stats.byHitter, points)}   error de quien pega ${pct(stats.byError, points)}   puntos con calor ${pct(stats.heated, points)}   sin terminar ${stats.stalled}`,
    `pierde por error propio   A ${pct(stats.lostByError[0], stats.lost[0])}  B ${pct(stats.lostByError[1], stats.lost[1])}`,
    `golpe que gana  ${top(stats.winningShot)}`,
    `golpe errado    ${top(stats.missedShot)}`,
    `desde la red    A ${pct(stats.hitsAtNet[0], stats.hits[0])}  B ${pct(stats.hitsAtNet[1], stats.hits[1])}  todos ${pct(sum(stats.hitsAtNet), sum(stats.hits))}   sin dejarla picar ${pct(stats.hitsInTheAir, sum(stats.hits))}`,
    `al final        alguien en la red ${pct(stats.endNetVsBack + stats.endBothNet, points)} (red contra fondo ${pct(stats.endNetVsBack, points)}, y ahí gana la red ${pct(stats.endNetVsBackWonByNet, stats.endNetVsBack)}); los dos al fondo ${pct(stats.endBothBack, points)}`,
    `globo a quien está en la red   ${stats.lobVsNet}: le saca la red ${pct(stats.lobVsNetRetreat, stats.lobVsNet)}, punto para quien globea ${pct(stats.lobVsNetWon, stats.lobVsNet)}`,
    `la pelota que deja un golpe    ${left} | no devuelta ${stats.notReturned}`,
    `según el timing ` +
      Object.entries(stats.byQuality)
        .map(([key, entry]) => `${key} n=${entry.n} no devuelta ${pct(entry.notReturned, entry.n)}, gana el punto ${pct(entry.won, entry.n)}`)
        .join(' | '),
    `golpes          ${top(stats.kinds, 10)}`,
    `por qué erran   A: ${errorCauses(stats, 0)}   B: ${errorCauses(stats, 1)}`,
  ].join('\n');
}

/** Why each side's mistakes happened, the most common first (see tests/probe.ts). */
function errorCauses(stats: Stats, side: 0 | 1): string {
  const counts = stats.human.errors[side];
  const total = sum(Object.values(counts));
  const causes = (Object.keys(counts) as ErrorCause[]).filter((cause) => counts[cause] > 0).sort((a, b) => counts[b] - counts[a]);
  return causes.map((cause) => `${ERROR_NAME[cause]} ${pct(counts[cause], total)}`).join(', ') || '-';
}

interface Target {
  key: string;
  label: string;
  min: number;
  max: number;
  /** Chela is the defender: her points are allowed to be longer. */
  minChela?: number;
  maxChela?: number;
  show: (value: number) => string;
}

const asPct = (value: number): string => `${Math.round(value * 100)}%`;
const asNumber = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** docs/profundidad.md, 5.4. */
const TARGETS: Target[] = [
  { key: 'median', label: 'golpes por punto, mediana', min: 6, max: 9, minChela: 9, maxChela: 12, show: asNumber },
  { key: 'p90', label: 'golpes por punto, p90', min: 0, max: 18, maxChela: 24, show: asNumber },
  { key: 'seconds', label: 'segundos de peloteo, media', min: 8, max: 14, show: asNumber },
  { key: 'errors', label: 'puntos que terminan en error', min: 0.55, max: 0.65, show: asPct },
  { key: 'netHits', label: 'golpes desde la red', min: 0.35, max: 1, show: asPct },
  { key: 'endAtNet', label: 'terminan con alguien en la red', min: 0.5, max: 1, show: asPct },
  { key: 'lobTakesNet', label: 'el globo le saca la red', min: 0.5, max: 0.7, show: asPct },
  { key: 'builtWins', label: 'gana quien dejó una pelota difícil', min: 0.65, max: 1, show: asPct },
];

function gates(stats: Stats, rival: RivalId): string[] {
  const values = indicators(stats);
  return TARGETS.map((target) => {
    const value = values[target.key] ?? 0;
    const min = rival === HARDEST ? (target.minChela ?? target.min) : target.min;
    const max = rival === HARDEST ? (target.maxChela ?? target.max) : target.max;
    const inside = value >= min && value <= max;
    const range = max >= 1 && min > 0 && min < 1 ? `≥ ${target.show(min)}` : min === 0 ? `≤ ${target.show(max)}` : `${target.show(min)} a ${target.show(max)}`;
    return `  ${inside ? 'ok    ' : 'FUERA '} ${target.label.padEnd(36)} ${target.show(value).padStart(5)}   (meta ${range})`;
  });
}

const collected: Record<string, Record<string, number>> = {};

function keep(name: string, stats: Stats): void {
  collected[name] = indicators(stats);
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify(collected, null, 1));
}

describe('profundidad', () => {
  for (const rival of RIVALS) {
    if (ONLY && ONLY !== rival) continue;

    it(`${rival}: cómo se juegan los puntos y cuánto paga pensar`, () => {
      const out: string[] = [];
      const numbers = Object.entries(trialConfig().rivals[rival])
        .map(([key, value]) => `${key} ${typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}`)
        .join(', ');
      out.push(`\n${rival}: ${numbers}`);
      const person = (skill: SkillName, tactics: number): Setup => (config, seed) => [
        [humanEntry(seed, withTactics(SKILLS[skill], tactics))],
        [aiEntry(config, rival, seed + 1)],
      ];

      const mirror = play(`${rival} contra ${rival}`, (config, seed) => [[aiEntry(config, rival, seed)], [aiEntry(config, rival, seed + 1)]]);
      keep(`${rival} vs ${rival}`, mirror);
      out.push(describeStats(mirror));

      const cells: Array<{ skill: SkillName; plain: Stats; thinking: Stats }> = [];
      for (const skill of Object.keys(SKILLS) as SkillName[]) {
        const plain = play(`persona ${skill}, sin táctica, contra ${rival}`, person(skill, 0));
        const thinking = play(`persona ${skill}, con táctica, contra ${rival}`, person(skill, 1));
        keep(`${skill} sin táctica vs ${rival}`, plain);
        keep(`${skill} con táctica vs ${rival}`, thinking);
        cells.push({ skill, plain, thinking });
        if (skill === 'average') {
          out.push(describeStats(plain));
          out.push(describeStats(thinking));
          out.push(`\nMetas, persona promedio con táctica contra ${rival}:`, ...gates(thinking, rival));
        }
      }

      out.push(`\n¿Paga jugar con táctica? Contra ${rival}, con las mismas manos:`);
      for (const { skill, plain, thinking } of cells) {
        const a = indicators(plain);
        const b = indicators(thinking);
        const gap = Math.round((b.pointsA! - a.pointsA!) * 100);
        out.push(
          `  ${skill.padEnd(9)} puntos ${asPct(a.pointsA!)} → ${asPct(b.pointsA!)}  (${gap >= 0 ? '+' : ''}${gap} pp${gap < 15 ? ', FUERA: la meta es +15' : ''})   partidos ${a.winsA}/${MATCHES} → ${b.winsA}/${MATCHES}   golpes por punto ${mean(plain.lengths).toFixed(1)} → ${mean(thinking.lengths).toFixed(1)}`,
        );
      }
      if (rival === HARDEST) {
        const expert = cells.find((cell) => cell.skill === 'expert')!;
        const wins = expert.plain.wins[0];
        const limit = Math.round(MATCHES * 0.7);
        out.push(`  la experta sin táctica le gana ${wins} de ${MATCHES} a ${rival}${wins > limit ? `  FUERA: la meta es ${limit} o menos` : '  ok'}`);
      }
      const brief = cells
        .map(({ skill, plain, thinking }) => `${skill} ${asPct(indicators(plain).pointsA!)}→${asPct(indicators(thinking).pointsA!)} (${plain.wins[0]}→${thinking.wins[0]})`)
        .join('  ');
      const average = cells.find((cell) => cell.skill === 'average')!.thinking;
      out.push(
        `RESUMEN ${rival}: ${brief}  | promedio con táctica: golpes mediana ${quantile(average.lengths, 0.5)} p90 ${quantile(average.lengths, 0.9)}, ${mean(average.seconds).toFixed(1)} s, error ${pct(average.byError, average.lengths.length)}, red ${pct(sum(average.hitsAtNet), sum(average.hits))} | espejo: ${mean(mirror.lengths).toFixed(1)} golpes`,
      );
      for (const who of [0, 1] as const) {
        const share = ratio(mirror.lostByError[who], mirror.lost[who]);
        if (share < 0.4) out.push(`  FUERA: ${rival} contra sí misma pierde solo el ${asPct(share)} de sus puntos por error propio (meta: 40% o más)`);
      }
      console.log(out.join('\n'));
    });
  }
});
