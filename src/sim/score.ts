import { otherTeam, type TeamId } from './types';

export interface MatchFormat {
  /** Games needed to win a set. No two-game margin: these are short formats. */
  gamesToWin: number;
  setsToWin: number;
  /** At 40-40 the next point wins the game. When false, advantage is played. */
  goldenPoint: boolean;
  /** When both teams reach this many games the set is decided by a tie-break. Null = never. */
  tieBreakAt: number | null;
  /** Points needed to win the tie-break. Short and sudden: no two-point margin. */
  tieBreakPoints: number;
}

export interface ScoreState {
  /**
   * Points of each team in the current game: 0, 1, 2, 3 = 0, 15, 30, 40.
   * In a tie-break they are plain points.
   */
  points: [number, number];
  /** Games of each team in the current set. */
  games: [number, number];
  sets: [number, number];
  /** Final games of every finished set. */
  completedSets: Array<[number, number]>;
  servingTeam: TeamId;
  /** Which player of each team serves the next time that team serves. */
  serverIndex: [number, number];
  /** The current game is a tie-break. */
  tieBreak: boolean;
  /** Team that served the first point of the tie-break in progress. */
  tieBreakOpener: TeamId;
  winner: TeamId | null;
}

export interface AwardResult {
  game: TeamId | null;
  set: TeamId | null;
  match: TeamId | null;
  /** The point started a tie-break. */
  tieBreak: boolean;
}

export function createScore(firstServer: TeamId): ScoreState {
  return {
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    completedSets: [],
    servingTeam: firstServer,
    serverIndex: [0, 0],
    tieBreak: false,
    tieBreakOpener: firstServer,
    winner: null,
  };
}

/** A deep copy, safe to store or to hand to another match. */
export function cloneScore(score: ScoreState): ScoreState {
  return {
    points: [score.points[0], score.points[1]],
    games: [score.games[0], score.games[1]],
    sets: [score.sets[0], score.sets[1]],
    completedSets: score.completedSets.map((set) => [set[0], set[1]] as [number, number]),
    servingTeam: score.servingTeam,
    serverIndex: [score.serverIndex[0], score.serverIndex[1]],
    tieBreak: score.tieBreak,
    tieBreakOpener: score.tieBreakOpener,
    winner: score.winner,
  };
}

/** True when the next point decides the game for both teams. */
export function isGoldenPoint(score: ScoreState, format: MatchFormat): boolean {
  if (score.tieBreak) {
    const last = format.tieBreakPoints - 1;
    return score.points[0] === last && score.points[1] === last;
  }
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

/** What the scoreboard shows for a team: 0, 15, 30, 40 or V (ventaja); plain points in a tie-break. */
export function pointLabel(score: ScoreState, team: TeamId): string {
  const mine = score.points[team];
  if (score.tieBreak) return String(mine);
  const theirs = score.points[otherTeam(team)];
  if (mine >= 3 && theirs >= 3) return mine > theirs ? 'V' : '40';
  return LABELS[Math.min(mine, 3)] ?? '40';
}

function gameIsWon(mine: number, theirs: number, format: MatchFormat): boolean {
  if (mine < 4) return false;
  // With golden point, 40-40 is 3-3 and the fourth point always decides.
  return format.goldenPoint ? true : mine - theirs >= 2;
}

/** The serve moves on: the team that just served rotates its player, and the other team serves. */
function passServe(score: ScoreState, teamSizes: readonly [number, number]): void {
  const served = score.servingTeam;
  score.serverIndex[served] = (score.serverIndex[served] + 1) % Math.max(1, teamSizes[served]);
  score.servingTeam = otherTeam(served);
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
  const result: AwardResult = { game: null, set: null, match: null, tieBreak: false };
  if (score.winner !== null) return result;

  const other = otherTeam(team);
  score.points[team] += 1;

  if (score.tieBreak) {
    if (score.points[team] < format.tieBreakPoints) {
      // The opener serves one point; after that the serve changes every two.
      if ((score.points[0] + score.points[1]) % 2 === 1) passServe(score, teamSizes);
      return result;
    }
    // Whoever received first in the tie-break serves first in the next set.
    const opener = score.tieBreakOpener;
    if (score.servingTeam === opener) passServe(score, teamSizes);
    score.tieBreak = false;
  } else {
    if (!gameIsWon(score.points[team], score.points[other], format)) return result;
    // The serve changes team every game; inside a team it moves to the next player.
    passServe(score, teamSizes);
  }

  result.game = team;
  score.points = [0, 0];
  score.games[team] += 1;

  if (score.games[team] < format.gamesToWin) {
    if (
      format.tieBreakAt !== null &&
      score.games[0] === format.tieBreakAt &&
      score.games[1] === format.tieBreakAt
    ) {
      score.tieBreak = true;
      score.tieBreakOpener = score.servingTeam;
      result.tieBreak = true;
    }
    return result;
  }

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
