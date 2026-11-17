import type { CourtConfig, SideSegment } from '../config';
import type { TeamId } from './types';

/** Which team owns the half of the court a point is on. */
export const sideOf = (y: number): TeamId => (y < 0 ? 0 : 1);

/** Direction along y in which a team attacks: +1 for the near team, -1 for the far one. */
export const teamDir = (team: TeamId): 1 | -1 => (team === 0 ? 1 : -1);

/** The net sags: lowest at the centre, highest at the posts. */
export function netHeightAt(court: CourtConfig, x: number): number {
  const k = Math.min(1, Math.abs(x) / court.halfWidth);
  return court.netCenter + (court.netPost - court.netCenter) * k;
}

/** Glass and fence heights of the side wall at a given position along the court. */
export function sideWallAt(court: CourtConfig, y: number): SideSegment {
  const fromBack = court.halfLength - Math.abs(y);
  for (const segment of court.side) {
    if (fromBack <= segment.upTo) return segment;
  }
  return court.side[court.side.length - 1]!;
}

/**
 * True when a bounce at (x, y) is inside the service box on `receiver`'s half
 * whose x has the sign `boxSign`. The lines belong to the box.
 */
export function inServiceBox(
  court: CourtConfig,
  x: number,
  y: number,
  receiver: TeamId,
  boxSign: 1 | -1,
): boolean {
  const tolerance = 0.02;
  if (sideOf(y) !== receiver) return false;
  if (Math.abs(y) > court.serviceLine + tolerance) return false;
  return x * boxSign >= -tolerance;
}
