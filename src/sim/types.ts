/** Team 0 plays on the near half (y < 0), team 1 on the far half (y > 0). */
export type TeamId = 0 | 1;

export const otherTeam = (team: TeamId): TeamId => (team === 0 ? 1 : 0);

/**
 * What a controller can ask for. The simulation turns a drive into a volley
 * or a smash when the ball is taken in the air, and it owns the serve.
 */
export type ShotRequest = 'safe' | 'drive' | 'lob' | 'drop';
export type ShotKind = ShotRequest | 'volley' | 'smash' | 'serve';

/** How well the swing was timed against the arrival of the ball. */
export type Quality = 'perfect' | 'good' | 'early' | 'late';

export interface ShotIntent {
  kind: ShotRequest;
  /** Lateral aim in world space: -1 is the left edge of the screen, +1 the right edge. */
  aim: number;
}

/** What a controller wants its player to do during one simulation step. */
export interface PlayerIntent {
  /** When true the player runs to (targetX, targetY); otherwise it follows (moveX, moveY). */
  hasTarget: boolean;
  targetX: number;
  targetY: number;
  /** Direct movement in world space, each component in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** Set for exactly one step to request a swing. */
  swing: ShotIntent | null;
}

export function createIntent(): PlayerIntent {
  return { hasTarget: false, targetX: 0, targetY: 0, moveX: 0, moveY: 0, swing: null };
}

export function resetIntent(intent: PlayerIntent): void {
  intent.hasTarget = false;
  intent.moveX = 0;
  intent.moveY = 0;
  intent.swing = null;
}
