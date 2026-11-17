import { otherTeam, type TeamId } from './types';

export interface MatchFormat {
  /** Games needed to win a set. No two-game margin: this is a short format. */
  gamesToWin: number;
  setsToWin: number;
  /** At 40-40 the next point wins the game. When false, advantage is played. */
  goldenPoint: boolean;
}

export interface ScoreState {
  /** Points of each team in the current game: 0, 1, 2, 3 = 0, 15, 30, 40. */
  points: [number, number];
  /** Games of each team in the current set. */
  games: [number, number];
  sets: [number, number];
  /** Final games of every finished set. */
  completedSets: Array<[number, number]>;
  servingTeam: TeamId;
  /** Which player of each team serves the next time that team serves. */
  serverIndex: [number, number];
  winner: TeamId | null;
}

export interface AwardResult {
  game: TeamId | null;
  set: TeamId | null;
  match: TeamId | null;
}

export function createScore(firstServer: TeamId): ScoreState {
  return {
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    completedSets: [],
    servingTeam: firstServer,
    serverIndex: [0, 0],
    winner: null,
  };
}

/** True when the next point decides the game for both teams. */
export function isGoldenPoint(score: ScoreState, format: MatchFormat): boolean {
  return format.goldenPoint && score.points[0] >= 3 && score.points[1] >= 3;
}

/**
 * Side the server stands on, seen from the server: 1 is the right (deuce)
 * side, -1 the left. It starts on the right and alternates every point.
 */
export function serveSide(score: ScoreState): 1 | -1 {
  return (score.points[0] + score.points[1]) % 2 === 0 ? 1 : -1;
}

const LABELS = ['0', '15', '30', '40'] as const;

/** What the scoreboard shows for a team: 0, 15, 30, 40 or V (ventaja). */
export function pointLabel(score: ScoreState, team: TeamId): string {
  const mine = score.points[team];
  const theirs = score.points[otherTeam(team)];
  if (mine >= 3 && theirs >= 3) return mine > theirs ? 'V' : '40';
  return LABELS[Math.min(mine, 3)] ?? '40';
}

function gameIsWon(mine: number, theirs: number, format: MatchFormat): boolean {
  if (mine < 4) return false;
  // With golden point, 40-40 is 3-3 and the fourth point always decides.
  return format.goldenPoint ? true : mine - theirs >= 2;
}

/**
 * Gives a point to `team` and carries over to games, sets and the match.
 * `teamSizes` is needed to rotate the server inside each team.
 */
export function awardPoint(
  score: ScoreState,
  team: TeamId,
  format: MatchFormat,
  teamSizes: readonly [number, number],
): AwardResult {
  const result: AwardResult = { game: null, set: null, match: null };
  if (score.winner !== null) return result;

  const other = otherTeam(team);
  score.points[team] += 1;
  if (!gameIsWon(score.points[team], score.points[other], format)) return result;

  result.game = team;
  score.points = [0, 0];
  score.games[team] += 1;

  // The serve changes team every game; inside a team it moves to the next player.
  const served = score.servingTeam;
  score.serverIndex[served] = (score.serverIndex[served] + 1) % Math.max(1, teamSizes[served]);
  score.servingTeam = otherTeam(served);

  if (score.games[team] < format.gamesToWin) return result;

  result.set = team;
  score.sets[team] += 1;
  score.completedSets.push([score.games[0], score.games[1]]);
  if (score.sets[team] >= format.setsToWin) {
    result.match = team;
    score.winner = team;
    return result;
  }
  score.games = [0, 0];
  return result;
}
