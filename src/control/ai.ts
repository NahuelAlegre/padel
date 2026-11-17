import type { AILevel } from '../config';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import type { InterceptPlan } from '../sim/intercept';
import type { Controller, Match } from '../sim/match';
import type { Player } from '../sim/player';
import { otherTeam, type PlayerIntent, type ShotIntent } from '../sim/types';
import { autoMove } from './autopilot';

/**
 * Computer opponent.
 *
 * It does not cheat on the ball: the contact it runs to comes from the same
 * trajectory prediction the human's assisted movement uses, which already
 * includes the rebounds off the walls. What changes with the level is how
 * fast it reacts and moves (set on the player), how well it times the swing
 * and how clever its shot selection is.
 */
export class AIController implements Controller {
  private lastPlan: InterceptPlan | null = null;
  private swingAt = -1;
  private serveAt = -1;

  constructor(
    /** Can be swapped while a match is running (difficulty changed in the options). */
    public level: AILevel,
    private readonly rng: Rng,
  ) {}

  onServeSetup(): void {
    this.lastPlan = null;
    this.swingAt = -1;
    this.serveAt = -1;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);

    if (match.phase === 'serve') {
      if (match.serverId !== me.id) return;
      if (this.serveAt < 0) this.serveAt = match.time + this.level.serveDelay * this.rng.range(0.8, 1.3);
      if (match.time >= this.serveAt) {
        intent.swing = { kind: 'safe', aim: this.rng.range(-0.9, 0.9) };
        this.serveAt = -1;
      }
      return;
    }

    const plan = me.plan;
    if (!plan) {
      this.lastPlan = null;
      this.swingAt = -1;
      return;
    }
    if (plan !== this.lastPlan) {
      // A new contact: decide now how well this swing will be timed.
      this.lastPlan = plan;
      this.swingAt = plan.t + this.rng.gauss() * this.level.timingSigma;
    }
    if (this.swingAt >= 0 && match.time >= this.swingAt && match.time >= me.swingLockUntil) {
      intent.swing = this.chooseShot(match, me, plan);
      this.swingAt = -1;
    }
  }

  private chooseShot(match: Match, me: Player, plan: InterceptPlan): ShotIntent {
    const level = this.level;
    const rng = this.rng;
    // Aims are world-space sides, so nothing here depends on the half the AI plays on.
    const range = match.config.shots.specs.drive.aimRange;

    // The opponent closest to the net decides whether a lob is worth it.
    const opponents = match.teams[otherTeam(me.team)];
    let netDistance = Infinity;
    for (const opponent of opponents) netDistance = Math.min(netDistance, Math.abs(opponent.y));
    const opponentAtNet = netDistance < 4.8;
    const myNetDistance = Math.abs(plan.y);

    // Under pressure the percentage play is to lob and win time.
    const pressed = !plan.reachable || plan.slack < 0.12 || plan.z < 0.4;
    if (pressed && plan.kind !== 'volley') {
      if (rng.chance(0.55)) return { kind: 'lob', aim: rng.range(-0.6, 0.6) };
      return { kind: 'safe', aim: 0 };
    }

    if (rng.chance(1 - level.smart)) {
      // Not thinking: put it back somewhere in the middle.
      return { kind: rng.chance(0.3) ? 'safe' : 'drive', aim: rng.range(-0.6, 0.6) };
    }

    if (opponentAtNet && plan.kind !== 'volley' && rng.chance(0.35 + level.lobChance)) {
      return { kind: 'lob', aim: this.awayFrom(opponents, range) };
    }
    if (!opponentAtNet && netDistance > 7 && myNetDistance < 5 && rng.chance(level.dropChance * 2.5)) {
      return { kind: 'drop', aim: this.awayFrom(opponents, range) };
    }
    if (!opponentAtNet && plan.kind !== 'volley' && rng.chance(level.lobChance * 0.5)) {
      return { kind: 'lob', aim: rng.range(-0.7, 0.7) };
    }
    return { kind: 'drive', aim: this.awayFrom(opponents, range) };
  }

  /** Lateral aim (-1..1) that lands the ball as far as possible from the opponents. */
  private awayFrom(opponents: readonly Player[], range: number): number {
    let bestAim = 0;
    let bestGap = -Infinity;
    for (let aim = -1; aim <= 1.001; aim += 0.5) {
      const x = aim * range;
      let gap = Infinity;
      for (const opponent of opponents) gap = Math.min(gap, Math.abs(opponent.x - x));
      gap += this.rng.range(0, 0.8);
      if (gap > bestGap) {
        bestGap = gap;
        bestAim = aim;
      }
    }
    return clamp(bestAim + this.rng.range(-0.15, 0.15), -1, 1);
  }
}
