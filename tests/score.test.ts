import { describe, expect, it } from 'vitest';
import {
  awardPoint,
  createScore,
  isGoldenPoint,
  pointLabel,
  serveSide,
  type MatchFormat,
  type ScoreState,
} from '../src/sim/score';
import type { TeamId } from '../src/sim/types';

const golden: MatchFormat = { gamesToWin: 2, setsToWin: 1, goldenPoint: true };
const advantage: MatchFormat = { gamesToWin: 2, setsToWin: 1, goldenPoint: false };
const singles = [1, 1] as const;

function give(score: ScoreState, format: MatchFormat, ...winners: TeamId[]): void {
  for (const team of winners) awardPoint(score, team, format, singles);
}

const labels = (score: ScoreState): string => `${pointLabel(score, 0)}-${pointLabel(score, 1)}`;

describe('puntos', () => {
  it('cuenta 0, 15, 30, 40', () => {
    const score = createScore(0);
    expect(labels(score)).toBe('0-0');
    give(score, golden, 0);
    expect(labels(score)).toBe('15-0');
    give(score, golden, 0, 1);
    expect(labels(score)).toBe('30-15');
    give(score, golden, 0);
    expect(labels(score)).toBe('40-15');
  });

  it('el cuarto punto gana el juego', () => {
    const score = createScore(0);
    give(score, golden, 0, 0, 0);
    const result = awardPoint(score, 0, golden, singles);
    expect(result.game).toBe(0);
    expect(score.games).toEqual([1, 0]);
    expect(score.points).toEqual([0, 0]);
  });
});

describe('punto de oro', () => {
  it('en 40-40 el próximo punto define el juego', () => {
    const score = createScore(0);
    give(score, golden, 0, 1, 0, 1, 0);
    expect(isGoldenPoint(score, golden)).toBe(false);
    give(score, golden, 1);
    expect(labels(score)).toBe('40-40');
    expect(isGoldenPoint(score, golden)).toBe(true);

    const result = awardPoint(score, 1, golden, singles);
    expect(result.game).toBe(1);
    expect(score.games).toEqual([0, 1]);
  });

  it('sin punto de oro se juega con ventaja', () => {
    const score = createScore(0);
    give(score, advantage, 0, 0, 0, 1, 1, 1);
    expect(isGoldenPoint(score, advantage)).toBe(false);

    give(score, advantage, 0);
    expect(labels(score)).toBe('V-40');
    expect(score.games).toEqual([0, 0]);

    give(score, advantage, 1);
    expect(labels(score)).toBe('40-40');

    give(score, advantage, 1);
    expect(labels(score)).toBe('40-V');
    const result = awardPoint(score, 1, advantage, singles);
    expect(result.game).toBe(1);
  });
});

describe('juegos y partido', () => {
  it('el partido termina al llegar a los juegos pactados', () => {
    const score = createScore(0);
    give(score, golden, 0, 0, 0, 0);
    expect(score.winner).toBeNull();
    give(score, golden, 0, 0, 0);
    const result = awardPoint(score, 0, golden, singles);
    expect(result).toEqual({ game: 0, set: 0, match: 0 });
    expect(score.winner).toBe(0);
    expect(score.games).toEqual([2, 0]);
    expect(score.completedSets).toEqual([[2, 0]]);
  });

  it('se puede ganar 2 a 1', () => {
    const score = createScore(0);
    give(score, golden, 0, 0, 0, 0); // 1-0
    give(score, golden, 1, 1, 1, 1); // 1-1
    give(score, golden, 1, 1, 1, 1); // 1-2
    expect(score.winner).toBe(1);
    expect(score.games).toEqual([1, 2]);
  });

  it('después del final no se suman más puntos', () => {
    const score = createScore(0);
    give(score, golden, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(score.winner).toBe(0);
    const result = awardPoint(score, 1, golden, singles);
    expect(result).toEqual({ game: null, set: null, match: null });
    expect(score.points).toEqual([0, 0]);
  });

  it('con varios sets, los juegos vuelven a cero al empezar el siguiente', () => {
    const format: MatchFormat = { gamesToWin: 1, setsToWin: 2, goldenPoint: true };
    const score = createScore(0);
    give(score, format, 0, 0, 0);
    const first = awardPoint(score, 0, format, singles);
    expect(first).toEqual({ game: 0, set: 0, match: null });
    expect(score.sets).toEqual([1, 0]);
    expect(score.games).toEqual([0, 0]);
    give(score, format, 0, 0, 0, 0);
    expect(score.winner).toBe(0);
    expect(score.completedSets).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });
});

describe('saque', () => {
  it('cambia de equipo en cada juego', () => {
    const score = createScore(0);
    expect(score.servingTeam).toBe(0);
    give(score, golden, 1, 1, 1, 1);
    expect(score.servingTeam).toBe(1);
  });

  it('empieza por la derecha y alterna en cada punto', () => {
    const score = createScore(0);
    expect(serveSide(score)).toBe(1);
    give(score, golden, 0);
    expect(serveSide(score)).toBe(-1);
    give(score, golden, 1);
    expect(serveSide(score)).toBe(1);
    give(score, golden, 0, 0, 0); // game over: back to the right
    expect(serveSide(score)).toBe(1);
  });

  it('en dobles rota entre los cuatro jugadores', () => {
    const format: MatchFormat = { gamesToWin: 9, setsToWin: 1, goldenPoint: true };
    const doubles = [2, 2] as const;
    const score = createScore(0);
    const order: string[] = [];
    for (let game = 0; game < 5; game++) {
      const team = score.servingTeam;
      order.push(`${team === 0 ? 'A' : 'B'}${score.serverIndex[team]}`);
      for (let point = 0; point < 4; point++) awardPoint(score, 0, format, doubles);
    }
    expect(order).toEqual(['A0', 'B0', 'A1', 'B1', 'A0']);
  });
});
