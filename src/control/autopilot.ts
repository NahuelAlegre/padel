import { clamp } from '../core/math';
import { homeSpot } from '../sim/formation';
import type { Match } from '../sim/match';
import { pairSpot } from '../sim/pair';
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
    // Still reading it, or doubting over a ball through the middle.
    const stillReading = (trajectory !== null && match.time < trajectory.t0 + me.reaction) || match.time < me.doubtUntil;
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

  const team = match.teams[me.team];
  if (team.length === 2) {
    // A pair: at the pair's depth, on its own side, slid toward the ball (see src/sim/pair.ts).
    const partner = team[0] === me ? team[1]! : team[0]!;
    pairSpot(me, partner, match.pairs[me.team], match.ball.x, match.config, spot);
    intent.targetX = spot.x;
    intent.targetY = spot.y;
    return;
  }

  // Recover: back to the resting position, shaded toward the side the ball is on.
  const teamSize = team.length;
  homeSpot(me.team, me.index, teamSize, me.homeMode, match.config, spot);
  const shade = teamSize === 1 ? clamp(match.ball.x * 0.25, -1.2, 1.2) : 0;
  intent.targetX = spot.x + shade;
  intent.targetY = spot.y;
}
