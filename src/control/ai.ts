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
 * It plays by the rules a person plays by. The contact it runs to comes from
 * the same trajectory prediction the visual aids use, which already includes
 * the rebounds off the walls; it asks for shots the same way a person does
 * (side, depth, over or through) and the situation names them.
 *
 * What makes one rival different from another is how fast it reacts and moves
 * (set on the player), how well it times the swing, how clever its targets
 * are and its style: how much it lobs, drops and goes to the net.
 */
export class AIController implements Controller {
  private lastPlan: InterceptPlan | null = null;
  private swingAt = -1;
  private serveAt = -1;
  private home: 'back' | 'net' | null = null;
  private seenHits = 0;
  private ownHits = 0;

  constructor(
    /** Can be swapped while a match is running (rival changed in the options). */
    public level: AILevel,
    private readonly rng: Rng,
  ) {}

  onServeSetup(): void {
    this.lastPlan = null;
    this.swingAt = -1;
    this.serveAt = -1;
    this.home = null;
    this.seenHits = 0;
    this.ownHits = 0;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    // Style: after each of its own shots it decides whether to follow it to the net.
    if (match.rallyHits !== this.seenHits) {
      this.seenHits = match.rallyHits;
      if (match.rally.live && match.rally.hitter === me.team) {
        this.ownHits++;
        this.home = me.homeMode === 'net' && this.rng.chance(this.level.netRush) ? 'net' : 'back';
      }
    }
    intent.home = this.home;
    autoMove(match, me, intent);

    if (match.phase === 'serve') {
      if (match.serverId !== me.id) return;
      if (this.serveAt < 0) this.serveAt = match.time + this.level.serveDelay * this.rng.range(0.8, 1.3);
      if (match.time >= this.serveAt) {
        intent.swing = { aim: this.rng.range(-0.9, 0.9), depth: 0.6, lob: false, power: 1 };
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
      this.swingAt = -1;
      // While the person is learning, it gives one ball back and lets the next one go.
      if (match.tutorial && this.ownHits >= (match.server.team === me.team ? 2 : 1)) return;
      intent.swing = this.chooseShot(match, me, plan);
    }
  }

  private chooseShot(match: Match, me: Player, plan: InterceptPlan): ShotIntent {
    const level = this.level;
    const rng = this.rng;
    const opponents = match.teams[otherTeam(me.team)];
    // Aims are world-space sides, so nothing here depends on the half the AI plays on.
    const range = match.config.shots.specs.drive.aimRange;

    if (match.tutorial) {
      // A slow ball straight to the person: the first rally is the tutorial.
      const target = opponents[0]!;
      return { aim: clamp(target.x / range, -1, 1), depth: 0.5, lob: false, power: 0.62 };
    }

    // The opponent closest to the net decides whether a lob is worth it.
    let netDistance = Infinity;
    for (const opponent of opponents) netDistance = Math.min(netDistance, Math.abs(opponent.y));
    const opponentAtNet = netDistance < 4.8;
    const myNetDistance = Math.abs(plan.y);
    const away = (): number => this.awayFrom(opponents, range);

    // Under pressure the percentage play is to lob and win time.
    const pressed = !plan.reachable || plan.slack < 0.12 || plan.z < 0.4;
    if (pressed && plan.kind !== 'volley') {
      if (rng.chance(0.55)) return { aim: rng.range(-0.6, 0.6), depth: 1, lob: true, power: 1 };
      return { aim: 0, depth: 0.55, lob: false, power: 1 };
    }

    if (rng.chance(1 - level.smart)) {
      // Not thinking: put it back somewhere in the middle.
      return { aim: rng.range(-0.6, 0.6), depth: rng.range(0.45, 0.85), lob: false, power: 1 };
    }

    if (opponentAtNet && plan.kind !== 'volley' && rng.chance(0.3 + level.lobChance)) {
      return { aim: away(), depth: 1, lob: true, power: 1 };
    }
    if (!opponentAtNet && netDistance > 7 && myNetDistance < 5 && rng.chance(level.dropChance * 2.5)) {
      return { aim: away(), depth: 0.1, lob: false, power: 1 };
    }
    if (!opponentAtNet && plan.kind !== 'volley' && rng.chance(level.lobChance * 0.6)) {
      return { aim: rng.range(-0.7, 0.7), depth: 1, lob: true, power: 1 };
    }
    return { aim: away(), depth: rng.range(0.8, 1), lob: false, power: 1 };
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
