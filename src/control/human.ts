import type { InputState } from '../input/state';
import { teamDir } from '../sim/court';
import type { Controller, Match } from '../sim/match';
import type { Player } from '../sim/player';
import type { PlayerIntent } from '../sim/types';
import { autoMove } from './autopilot';

/** The stick is rounded to this many steps per axis: recordings stay small and exact. */
const STICK_STEPS = 32;

/**
 * A player driven by a person.
 *
 * The person moves the player and chooses where to hit; which shot that is
 * comes from the situation. A player with assisted movement (an accessibility
 * option, `manual` off) runs to the ball by itself and the person only hits.
 */
export class HumanController implements Controller {
  constructor(private readonly input: InputState) {}

  update(match: Match, me: Player, intent: PlayerIntent): void {
    // The camera sits behind this player's team, so screen-up is toward the net.
    const dir = teamDir(me.team);
    if (me.manual) {
      intent.moveX = (Math.round(this.input.moveX * STICK_STEPS) / STICK_STEPS) * dir;
      intent.moveY = (Math.round(this.input.moveY * STICK_STEPS) / STICK_STEPS) * dir;
    } else {
      autoMove(match, me, intent);
    }

    const swing = this.input.takeSwing();
    if (swing) intent.swing = { aim: swing.aim * dir, depth: swing.depth, lob: swing.lob, power: swing.power };
  }
}
