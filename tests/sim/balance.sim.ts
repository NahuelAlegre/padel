import { describe, it } from 'vitest';
import type { RivalId } from '../../src/config';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { aiEntry, humanEntry, playMatch, SKILLS, testConfig, type MatchSummary } from '../helpers';

/**
 * Balance report: `npm run sim`.
 * Plays many headless matches and prints how the points are won and lost.
 * Nothing is asserted; it is here to tune the numbers in src/config.ts.
 *
 * SIM_MATCHES=10 npm run sim  -> quicker, noisier report.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 40);

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
}

function share(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key} ${Math.round((value / total) * 100)}%`)
    .join(', ');
}

function report(title: string, makeTeams: (seed: number) => [PlayerEntry[], PlayerEntry[]]): void {
  const reasons: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  const qualities: [Record<string, number>, Record<string, number>] = [{}, {}];
  const lengths: number[] = [];
  const wins = [0, 0];
  const pointsWon = [0, 0];
  let seconds = 0;
  let faults = 0;
  let stalled = 0;

  for (let i = 0; i < MATCHES; i++) {
    const config = testConfig();
    const [near, far] = makeTeams(1000 + i * 7);
    const match = new Match({
      config,
      seed: 500 + i,
      firstServer: i % 2 === 0 ? 0 : 1,
      teams: [
        { name: 'A', players: near },
        { name: 'B', players: far },
      ],
    });
    const summary: MatchSummary = playMatch(match);
    if (summary.stalled) stalled++;
    if (summary.winner >= 0) wins[summary.winner]!++;
    add(reasons, summary.reasons);
    add(kinds, summary.kinds);
    add(qualities[0], summary.qualities[0]);
    add(qualities[1], summary.qualities[1]);
    lengths.push(...summary.rallyLengths);
    pointsWon[0]! += summary.pointsWon[0];
    pointsWon[1]! += summary.pointsWon[1];
    seconds += summary.simSeconds;
    faults += summary.faults;
  }

  lengths.sort((a, b) => a - b);
  const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0;
  console.log(
    [
      `\n=== ${title} (${MATCHES} partidos) ===`,
      `partidos ganados  A ${wins[0]} - B ${wins[1]}   puntos  A ${pointsWon[0]} - B ${pointsWon[1]}`,
      `duración media    ${(seconds / MATCHES).toFixed(0)} s de juego, ${(lengths.length / MATCHES).toFixed(1)} puntos, ${(seconds / (lengths.length || 1)).toFixed(1)} s por punto`,
      `golpes por punto  media ${mean.toFixed(1)}, mediana ${median}, p90 ${p90}, máx ${lengths[lengths.length - 1] ?? 0}`,
      `cómo terminan     ${share(reasons)}`,
      `golpes            ${share(kinds)}`,
      `timing A          ${share(qualities[0])}`,
      `timing B          ${share(qualities[1])}`,
      `faltas de saque   ${faults}   partidos trabados ${stalled}`,
    ].join('\n'),
  );
}

describe('balance', () => {
  const rivals: RivalId[] = ['beto', 'romina', 'chela'];

  for (const rival of rivals) {
    it(`${rival} contra sí misma`, () => {
      report(`${rival} vs ${rival}`, (seed) => {
        const config = testConfig();
        return [[aiEntry(config, rival, seed)], [aiEntry(config, rival, seed + 1)]];
      });
    });
  }

  for (const rival of rivals) {
    for (const [name, skill] of Object.entries(SKILLS)) {
      it(`persona ${name} contra ${rival}`, () => {
        report(`Persona ${name} (a mano) vs ${rival}`, (seed) => {
          const config = testConfig();
          return [[humanEntry(seed, skill)], [aiEntry(config, rival, seed + 1)]];
        });
      });
    }
  }

  it('persona con movimiento asistido', () => {
    report('Persona promedio (movimiento asistido) vs romina', (seed) => {
      const config = testConfig();
      return [[humanEntry(seed, SKILLS.average, { manual: false, reaction: 0.12 })], [aiEntry(config, 'romina', seed + 1)]];
    });
  });

  it('dobles: cuatro IA', () => {
    report('Dobles (nivel medio)', (seed) => {
      const config = testConfig();
      return [
        [aiEntry(config, 'medium', seed), aiEntry(config, 'medium', seed + 1)],
        [aiEntry(config, 'medium', seed + 2), aiEntry(config, 'medium', seed + 3)],
      ];
    });
  });
});
