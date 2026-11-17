import { describe, it } from 'vitest';
import type { AILevelName } from '../../src/config';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { aiEntry, humanEntry, playMatch, testConfig, type MatchSummary } from '../helpers';

/**
 * Balance report: `npm run sim`.
 * Plays many headless matches and prints how the points are won and lost.
 * Nothing is asserted; it is here to tune the numbers in src/config.ts.
 */

// SIM_MATCHES=10 npm run sim  -> quicker, noisier report.
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
      `duración media    ${(seconds / MATCHES).toFixed(0)} s de juego, ${(lengths.length / MATCHES).toFixed(1)} puntos`,
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
  const levels: AILevelName[] = ['easy', 'normal', 'hard'];

  for (const level of levels) {
    it(`IA ${level} contra sí misma`, () => {
      report(`IA ${level} vs IA ${level}`, (seed) => {
        const config = testConfig();
        return [[aiEntry(config, level, seed)], [aiEntry(config, level, seed + 1)]];
      });
    });
  }

  for (const level of levels) {
    for (const sigma of [0.05, 0.1, 0.16]) {
      it(`jugador (timing ±${sigma * 1000} ms) contra IA ${level}`, () => {
        report(`Jugador σ=${sigma * 1000} ms vs IA ${level}`, (seed) => {
          const config = testConfig();
          return [[humanEntry(seed, sigma)], [aiEntry(config, level, seed + 1)]];
        });
      });
    }
  }

  it('dobles: cuatro IA', () => {
    report('Dobles IA normal', (seed) => {
      const config = testConfig();
      return [
        [aiEntry(config, 'normal', seed), aiEntry(config, 'normal', seed + 1)],
        [aiEntry(config, 'normal', seed + 2), aiEntry(config, 'normal', seed + 3)],
      ];
    });
  });
});
