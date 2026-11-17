import type { InputState } from '../input/state';
import { teamDir } from '../sim/court';
import type { Controller, Match } from '../sim/match';
import type { Player } from '../sim/player';
import type { PlayerIntent } from '../sim/types';
import { autoMove } from './autopilot';

/**
 * A player driven by a person.
 *
 * In the default mode the simulation moves the player to the ball and the
 * person only decides when and where to hit. A player flagged as `manual`
 * is moved with the stick or the keys instead.
 */
export class HumanController implements Controller {
  constructor(private readonly input: InputState) {}

  update(match: Match, me: Player, intent: PlayerIntent): void {
    // The camera sits behind this player's team, so screen-up is toward the net.
    const dir = teamDir(me.team);
    if (me.manual) {
      intent.moveX = this.input.moveX * dir;
      intent.moveY = this.input.moveY * dir;
    } else {
      autoMove(match, me, intent);
    }

    const swing = this.input.takeSwing();
    if (swing) intent.swing = { kind: swing.kind, aim: swing.aim * dir };
  }
}
