import type { AILevel } from '../config';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { InterceptPlan } from '../sim/intercept';
import type { Controller, Match } from '../sim/match';
import type { Player } from '../sim/player';
import { otherTeam, type PlayerIntent, type ShotIntent } from '../sim/types';
import { autoMove } from './autopilot';

/** How much wilder than usual a mishit ball leaves the racket. */
const MISHIT_SCATTER = 3;

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
 * are and its style: how hard it hits, how much it lobs, drops, goes to the
 * net and aims at the walls, and the few habits that make it somebody.
 *
 * It is also honest about what it is going to do. It makes up its mind a
 * moment before the contact and from then on holds that shot as its cue, which
 * is what its windup shows. It does not change it unless the ball does.
 */
export class AIController implements Controller {
  private lastPlan: InterceptPlan | null = null;
  private swingAt = -1;
  private serveAt = -1;
  private home: 'back' | 'net' | null = null;
  private seenHits = 0;
  private ownHits = 0;
  /** The shot decided for the contact in `lastPlan`, once it is time to decide. */
  private cue: ShotIntent | null = null;

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
    this.cue = null;
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
      this.cue = null;
      return;
    }
    if (plan !== this.lastPlan) {
      // A new contact: decide now how well this swing will be timed. Whatever
      // had been decided was for another ball.
      this.lastPlan = plan;
      this.swingAt = plan.t + this.rng.gauss() * this.level.timingSigma;
      this.cue = null;
    }
    if (this.swingAt < 0) return;

    // While the person is learning, it gives one ball back and lets the next one go.
    const letItGo = match.tutorial && this.ownHits >= (match.server.team === me.team ? 2 : 1);
    if (letItGo) {
      if (match.time >= this.swingAt) this.swingAt = -1;
      return;
    }

    // Make up its mind a moment before the ball arrives, and show it.
    const swingNow = match.time >= this.swingAt && match.time >= me.swingLockUntil;
    if (!this.cue && (swingNow || match.time >= plan.t - this.level.tellLead)) {
      this.cue = this.chooseShot(match, me, plan);
    }
    intent.cue = this.cue;
    if (swingNow && this.cue) {
      this.swingAt = -1;
      intent.swing = this.cue;
    }
  }

  private chooseShot(match: Match, me: Player, plan: InterceptPlan): ShotIntent {
    const level = this.level;
    const rng = this.rng;
    const opponents = match.teams[otherTeam(me.team)];
    // Aims are world-space sides, so nothing here depends on the half the AI plays on.
    const range = match.config.shots.specs.drive.aimRange;
    const toward = (): number => clamp(opponents[0]!.x / range, -1, 1);

    if (match.tutorial) {
      // A slow ball straight to the person: the first rally is the tutorial.
      return { aim: toward(), depth: 0.5, lob: false, power: 0.62 };
    }

    // What this swing is like for this player: wilder deep into a rally for
    // the impatient, wilder off the glass for those who do not like it.
    let scatter = 1 + Math.max(0, match.rallyHits - level.impatientAfter) * level.impatience;
    if (plan.kind === 'wall') scatter *= level.wallScatter;
    // And every so often it just mishits one.
    if (rng.chance(level.mishit)) scatter *= MISHIT_SCATTER;
    const shot = (aim: number, depth: number, lob: boolean, power = level.power): ShotIntent => ({
      aim,
      depth,
      lob,
      power,
      scatter,
    });

    // The opponent closest to the net decides whether a lob is worth it.
    let netDistance = Infinity;
    for (const opponent of opponents) netDistance = Math.min(netDistance, Math.abs(opponent.y));
    const opponentAtNet = netDistance < 4.8;
    const myNetDistance = Math.abs(plan.y);
    const away = (): number => this.awayFrom(opponents, range) * lerp(0.55, 1, level.angle);
    const middle = (): number => rng.range(-0.6, 0.6) * lerp(0.5, 1, level.angle);

    // Under pressure the percentage play is to lob and win time.
    const pressed = !plan.reachable || plan.slack < 0.12 || plan.z < 0.4;
    if (pressed && plan.kind !== 'volley') {
      if (level.lobUnderPressure || rng.chance(0.55)) return shot(middle(), 1, true);
      return shot(0, 0.55, false);
    }

    // A coach feeds: a comfortable ball to where the other player is standing.
    if (rng.chance(level.feed)) return shot(toward(), rng.range(0.5, 0.7), false);

    if (rng.chance(1 - level.smart)) {
      // Not thinking: put it back somewhere in the middle.
      return shot(middle(), rng.range(0.45, 0.85), false);
    }

    if (opponentAtNet && plan.kind !== 'volley' && rng.chance(0.3 + level.lobChance)) {
      return shot(away(), 1, true);
    }
    if (!opponentAtNet && netDistance > 7 && myNetDistance < 5 && rng.chance(level.dropChance * 2.5)) {
      return shot(away(), 0.1, false);
    }
    if (!opponentAtNet && plan.kind !== 'volley' && rng.chance(level.lobChance * 0.6)) {
      return shot(middle(), 1, true);
    }
    // The ordinary shot: hard, deep and away for the aggressive; a safer
    // length for the rest.
    if (rng.chance(level.aggression)) return shot(away(), rng.range(0.8, 1), false);
    return shot(away(), rng.range(0.55, 0.85), false);
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
