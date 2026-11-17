import { it } from 'vitest';
import type { AILevelName } from '../../src/config';
import { Match } from '../../src/sim/match';
import { aiEntry, playMatch, testConfig } from '../helpers';

/**
 * Prints every hit of one match, to read how rallies actually unfold.
 *   SIM_LEVEL=hard SIM_SEED=3 npx vitest run --config vitest.sim.config.ts rally
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

it('rally log', () => {
  const level = (env?.SIM_LEVEL ?? 'hard') as AILevelName;
  const seed = Number(env?.SIM_SEED ?? 1);
  const config = testConfig();
  const match = new Match({
    config,
    seed,
    teams: [
      { name: 'A', players: [aiEntry(config, level, seed * 11)] },
      { name: 'B', players: [aiEntry(config, level, seed * 13)] },
    ],
  });
  const lines: string[] = [];
  let line: string[] = [];
  const f = (n: number): string => n.toFixed(1).padStart(5);
  playMatch(match, 3600, (event) => {
    if (event.type === 'hit') {
      const who = event.team === 0 ? 'A' : 'B';
      line.push(
        `${who} ${event.kind.padEnd(6)} ${event.quality.padEnd(7)} @(${f(event.x)},${f(event.y)},${f(event.z)}) ${event.speed.toFixed(0)}m/s`,
      );
    } else if (event.type === 'point') {
      lines.push(`--- punto para ${event.winner === 0 ? 'A' : 'B'} (${event.reason}), ${line.length} golpes`);
      lines.push(...line.map((entry) => `    ${entry}`));
      line = [];
    } else if (event.type === 'fault' || event.type === 'let') {
      lines.push(`--- ${event.type}`);
      line = [];
    }
  });
  console.log(lines.join('\n'));
});
