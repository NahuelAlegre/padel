import { clamp } from '../core/math';
import { homeSpot } from '../sim/formation';
import type { Match } from '../sim/match';
import { clampToHalf, type Player } from '../sim/player';
import type { PlayerIntent } from '../sim/types';

const spot = { x: 0, y: 0 };

/**
 * Assisted movement, shared by the AI and by the default human controls:
 * run to the contact the simulation planned for this player, and go back to a
 * sensible resting position while the ball is on the other side.
 */
export function autoMove(match: Match, me: Player, intent: PlayerIntent): void {
  if (match.phase !== 'rally') return;
  intent.hasTarget = true;

  const plan = me.plan;
  if (plan) {
    intent.targetX = plan.stanceX;
    intent.targetY = plan.stanceY;
    return;
  }

  const rally = match.rally;
  const incoming = rally.live && rally.hitter !== me.team;
  if (incoming && match.assigned[me.team] === me.id) {
    const trajectory = match.trajectory;
    const stillReading = trajectory !== null && match.time < trajectory.t0 + me.reaction;
    if (stillReading || match.shouldLeave(me.team)) {
      // Not read yet, or it is going out by itself: hold the position.
      intent.targetX = me.x;
      intent.targetY = me.y;
      return;
    }
    // No playable contact left: chase the ball anyway.
    clampToHalf(me.team, match.ball.x, match.ball.y, match.config, spot);
    intent.targetX = spot.x;
    intent.targetY = spot.y;
    return;
  }

  // Recover: back to the resting position, shaded toward the side the ball is on.
  const teamSize = match.teams[me.team].length;
  homeSpot(me.team, me.index, teamSize, me.homeMode, match.config, spot);
  const shade = teamSize === 1 ? clamp(match.ball.x * 0.25, -1.2, 1.2) : 0;
  intent.targetX = spot.x + shade;
  intent.targetY = spot.y;
}
