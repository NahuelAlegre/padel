import type { GameConfig } from '../config';
import { teamDir } from './court';
import type { TeamId } from './types';

/**
 * Positions are written in "team space" and converted to the world here, so
 * the same table works for both halves:
 *   right  = metres toward the team's own right-hand side,
 *   depth  = metres from the net.
 * Player 0 of a team covers the right side, player 1 the left.
 */
export interface Spot {
  x: number;
  y: number;
}

export function toWorld(team: TeamId, right: number, depth: number): Spot {
  const dir = teamDir(team);
  return { x: right * dir, y: -dir * depth };
}

/** Lateral position of a player inside its team: centred alone, a half each in doubles. */
function lane(index: number, teamSize: number, config: GameConfig): number {
  if (teamSize <= 1) return 0;
  const half = config.court.halfWidth / 2;
  return index === 0 ? half : -half;
}

/** Resting position during the rally. Written into `out` because it runs every step. */
export function homeSpot(
  team: TeamId,
  index: number,
  teamSize: number,
  mode: 'back' | 'net',
  config: GameConfig,
  out: Spot,
): void {
  const dir = teamDir(team);
  const depth = mode === 'net' ? config.player.homeNet : config.player.homeBack;
  out.x = lane(index, teamSize, config) * dir;
  out.y = -dir * depth;
}

/**
 * Where a player stands while the serve is prepared.
 * `side` is the side the server serves from, seen from the server: 1 = right.
 * The serve goes diagonally, so the receiver waits on the same side seen from
 * its own half.
 */
export function serveSpot(
  team: TeamId,
  index: number,
  teamSize: number,
  servingTeam: TeamId,
  serverIndex: number,
  side: 1 | -1,
  config: GameConfig,
): Spot {
  const { court, rules } = config;
  const half = court.halfWidth / 2;

  if (team === servingTeam) {
    if (index === serverIndex) {
      return toWorld(team, side * rules.serverX, court.serviceLine + rules.serverBehindLine);
    }
    // The server's partner waits at the net on the other half.
    return toWorld(team, -side * half, config.player.homeNet);
  }

  if (index === receiverIndex(teamSize, side)) {
    return toWorld(team, side * (half + 0.1), court.halfLength - 1.6);
  }
  // The receiver's partner waits around the service line on the other half.
  return toWorld(team, -side * half, court.serviceLine - 0.5);
}

/** In doubles the player on the side the serve is aimed at receives. */
export function receiverIndex(teamSize: number, side: 1 | -1): number {
  if (teamSize <= 1) return 0;
  return side === 1 ? 0 : 1;
}

/** Sign of x of the service box a serve from `servingTeam` on `side` must land in. */
export function serveBoxSign(servingTeam: TeamId, side: 1 | -1): 1 | -1 {
  return (-side * teamDir(servingTeam)) as 1 | -1;
}
