import type { AILevel } from '../config';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { InterceptPlan } from '../sim/intercept';
import type { Controller, Match } from '../sim/match';
import { BACK_LINE, NET_LINE } from '../sim/pair';
import type { Player } from '../sim/player';
import { otherTeam, type PlayerIntent, type ShotIntent } from '../sim/types';
import { autoMove } from './autopilot';

/** How much wilder than usual a mishit ball leaves the racket. */
const MISHIT_SCATTER = 3;
/** Closer to the net than this, the opponent is at the net: a lob or a chiquita is worth it. */
const RIVAL_AT_NET = 4.8;
/** Further from the net than this, the opponent is at the back: the short ball is open. */
const RIVAL_AT_BACK = 7;
/** A ball met this close to the net, this far above the tape and with this much time is there to be attacked. */
const ATTACK_ZONE = 6.5;
const ATTACK_ABOVE_TAPE = 0.25;
const ATTACK_SLACK = 0.1;
/** How deep a finishing shot is asked for (0..1) with nobody at the net: short of the back glass. */
const FINISH_DEPTH = [0.3, 0.55] as const;
/** Somebody who does not finish the ball puts it back this much slower. */
const SAFE_POWER = 0.8;
/**
 * Doubles: how often somebody waiting half way gets the ball at the feet, and
 * the depth asked for (0..1) to land it there: from how far from the net it
 * stands, over the span of an ordinary shot, within these limits (below the
 * lower one it would be a chiquita).
 */
const FEET_CHANCE = 0.7;
const FEET_FROM = 4.8;
const FEET_SPAN = 3.4;
const FEET_DEPTH = [0.28, 0.6] as const;
/** Doubles: the depth asked for (0..1) to land the ball in the hole of a pair split in two. */
const HOLE_DEPTH = 0.35;
/** Doubles: how often even somebody who never goes to the net goes up behind its serve. */
const DOUBLES_SERVE_UP = 0.6;
/** Doubles, both pairs at the back: how much more than its taste a player lobs and plays short, to go up. */
const BUILD_LOB = 1;
const BUILD_DROP = 1.5;

/**
 * Computer opponent.
 *
 * It plays by the rules a person plays by. The contact it runs to comes from
 * the same trajectory prediction the visual aids use, which already includes
 * the rebounds off the walls; it asks for shots the same way a person does
 * (side, depth, over or through) and the situation names them. A good shot of
 * the other side makes its answer worse the same way, and a run of them gets
 * to it.
 *
 * It decides with what anybody can see on the court: where the ball is going
 * and where everybody is standing. It never looks at what the other side is
 * about to do.
 *
 * What makes one rival different from another is how it plays padel: how
 * well it reads the point (`smart`), whether it finishes the ball that is
 * there to be attacked (`punish`), whether it goes to the net and holds it
 * (`netRush`, `holdNet`), how steady its hands are and how little a bad run
 * gets to it (`composure`). On top of that, its style: how hard it hits, how
 * much it lobs, drops and aims at the walls, and the few habits that make it
 * somebody. Never how fast it runs: nobody here outruns a person.
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
  /** It lobbed and means to go up behind it, once it sees the ball get past. */
  private followLob = false;
  /** The shot decided for the contact in `lastPlan`, once it is time to decide. */
  private cue: ShotIntent | null = null;
  /** It plays doubles, with a partner. */
  private pair = false;

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
    this.followLob = false;
    this.cue = null;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    const rally = match.rally;
    // After each of its own shots it decides where to wait for the next ball.
    if (match.rallyHits !== this.seenHits) {
      this.seenHits = match.rallyHits;
      this.pair = match.teams[me.team].length === 2;
      if (rally.live && rally.hitter === me.team) {
        this.ownHits++;
        this.home = this.whereToWait(me);
      }
    }
    // The lob it meant to follow: up it goes when the ball has got past, which is when it bounces.
    if (this.followLob && rally.live && rally.hitter === me.team && rally.bounces >= 1) {
      this.followLob = false;
      this.home = 'net';
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

  /**
   * Where it waits after the shot it has just played. The match already says
   * whether that shot is a way to the net; its style says whether it takes it.
   */
  private whereToWait(me: Player): 'back' | 'net' {
    const level = this.level;
    this.followLob = false;
    if (me.homeMode !== 'net') return 'back';
    switch (me.anim.shot) {
      case 'lob':
        // Nobody runs in behind a lob before seeing whether it gets past.
        this.followLob = this.rng.chance(level.netRush);
        return 'back';
      case 'volley':
      case 'bandeja':
      case 'vibora':
      case 'smash':
        // It is at the net already: holding it is staying there.
        return this.rng.chance(lerp(0.5, 1, level.holdNet)) ? 'net' : 'back';
      case 'serve':
        // In doubles the serving pair goes up behind the serve: it is the first thing anybody learns.
        return this.rng.chance(this.pair ? lerp(DOUBLES_SERVE_UP, 1, level.netRush) : level.netRush) ? 'net' : 'back';
      default:
        return this.rng.chance(level.netRush) ? 'net' : 'back';
    }
  }

  private chooseShot(match: Match, me: Player, plan: InterceptPlan): ShotIntent {
    const level = this.level;
    const rng = this.rng;
    const config = match.config;
    const opponents = match.teams[otherTeam(me.team)];
    // Aims are world-space sides, so nothing here depends on the half the AI plays on.
    const range = config.shots.specs.drive.aimRange;
    const toward = (): number => clamp(opponents[0]!.x / range, -1, 1);

    if (match.tutorial) {
      // A slow ball straight to the person: the first rally is the tutorial.
      return { aim: toward(), depth: 0.5, lob: false, power: 0.62 };
    }

    // What this swing is like for this player: wilder off the glass for those
    // who do not like it, and every so often, for those who do that, a mishit.
    let scatter = plan.kind === 'wall' ? level.wallScatter : 1;
    if (level.mishit > 0 && rng.chance(level.mishit)) scatter *= MISHIT_SCATTER;
    // The impatient bring their own strain to a point that goes on.
    const tension = level.impatience > 0 ? Math.max(0, match.rallyHits - level.impatientAfter) * level.impatience : 0;
    const shot = (aim: number, depth: number, lob: boolean, power = level.power): ShotIntent => ({
      aim,
      depth,
      lob,
      power,
      scatter,
      tension,
    });

    // Where the other side is standing decides what is worth playing.
    let netDistance = Infinity;
    for (const opponent of opponents) netDistance = Math.min(netDistance, Math.abs(opponent.y));
    const rivalAtNet = netDistance < RIVAL_AT_NET;
    const rivalAtBack = netDistance > RIVAL_AT_BACK;
    const myNetDistance = Math.abs(plan.y);
    const inTheAir = plan.kind === 'volley';
    const away = (): number => this.awayFrom(opponents, range) * lerp(0.55, 1, level.angle);
    const middle = (): number => rng.range(-0.6, 0.6) * lerp(0.5, 1, level.angle);

    // Under pressure the percentage play is to lob and win time.
    const pressed = !plan.reachable || plan.slack < 0.12 || plan.z < 0.4;
    if (pressed && !inTheAir) {
      if (level.lobUnderPressure || rng.chance(0.55)) return shot(middle(), 1, true);
      return shot(0, 0.55, false);
    }

    // A coach feeds: a comfortable ball to where the other player is standing.
    if (rng.chance(level.feed)) return shot(toward(), rng.range(0.5, 0.7), false);

    // A ball that is there to be attacked: close to the net, above the tape
    // and with time. Whoever knows how finishes it: away from the other one
    // (the situation makes it a smash when it is high enough) and, with
    // nobody at the net, not deep, so it dies in the side fence instead of
    // coming back off the glass; or short when the other one is far back.
    // Whoever does not know just puts it back in play.
    const attackable =
      myNetDistance < ATTACK_ZONE && plan.z >= config.court.netCenter + ATTACK_ABOVE_TAPE && plan.slack >= ATTACK_SLACK;
    if (attackable) {
      if (!rng.chance(level.punish)) return shot(middle(), rng.range(0.5, 0.8), false, level.power * SAFE_POWER);
      if (rivalAtBack && plan.z < config.player.overheadZ && rng.chance(level.dropChance * 2.5)) return shot(away(), 0.1, false);
      return shot(away(), rivalAtNet ? rng.range(0.85, 1) : rng.range(FINISH_DEPTH[0], FINISH_DEPTH[1]), false);
    }

    if (rng.chance(1 - level.smart)) {
      // Not thinking: put it back somewhere in the middle.
      return shot(middle(), rng.range(0.45, 0.85), false);
    }

    if (opponents.length === 2) return this.pairShot(opponents, inTheAir, myNetDistance, range, shot, away);

    if (rivalAtNet && !inTheAir) {
      // Somebody at the net: over their head, or at their feet.
      if (rng.chance(0.3 + level.lobChance)) return shot(away(), 1, true);
      if (rng.chance(level.dropChance * 2.5)) return shot(away(), 0.1, false);
    }
    // Somebody far back: the short ball makes them run in. From the net it is the obvious one.
    if (rivalAtBack && rng.chance(level.dropChance * (myNetDistance < 5 ? 2.5 : 1.2))) {
      return shot(away(), 0.1, false);
    }
    // A lob to somebody who is not at the net only makes sense now and then, to go up behind it.
    if (!rivalAtNet && !inTheAir && rng.chance(level.lobChance * 0.25)) {
      return shot(middle(), 1, true);
    }
    // The ordinary shot: hard, deep and away for the aggressive; a safer
    // length for the rest.
    if (rng.chance(level.aggression)) return shot(away(), rng.range(0.8, 1), false);
    return shot(away(), rng.range(0.55, 0.85), false);
  }

  /**
   * Doubles: the ball goes where the other pair is not. At the feet of
   * whoever waits half way; into the hole of a pair split in two, or over the
   * one at the net; over a pair at the net, or low through the middle; and,
   * to a pair at the back, through the middle and deep, which is the safe
   * ball and the one that makes two people doubt.
   */
  private pairShot(
    opponents: readonly Player[],
    inTheAir: boolean,
    myNetDistance: number,
    range: number,
    shot: (aim: number, depth: number, lob: boolean, power?: number) => ShotIntent,
    away: () => number,
  ): ShotIntent {
    const level = this.level;
    const rng = this.rng;
    const a = opponents[0]!;
    const b = opponents[1]!;
    const depthOf = (player: Player): number => Math.abs(player.y);
    const atNet = (player: Player): boolean => depthOf(player) < NET_LINE;
    const atBack = (player: Player): boolean => depthOf(player) > BACK_LINE;
    const aimAt = (x: number): number => clamp(x / range, -1, 1);
    const between = aimAt((a.x + b.x) / 2);
    const halfway = opponents.find((player) => !atNet(player) && !atBack(player));
    const split = (atNet(a) && atBack(b)) || (atNet(b) && atBack(a));

    if (halfway && rng.chance(FEET_CHANCE)) {
      // Half way between the net and the back: at the feet.
      return shot(aimAt(halfway.x), clamp((depthOf(halfway) - FEET_FROM) / FEET_SPAN, FEET_DEPTH[0], FEET_DEPTH[1]), false);
    }
    if (split && rng.chance(lerp(0.3, 1, level.punish))) {
      // A pair split in two: over the one at the net, or into the hole between them.
      const front = atNet(a) ? a : b;
      if (!inTheAir && myNetDistance > NET_LINE && rng.chance(0.5)) return shot(aimAt(front.x), 1, true);
      return shot(between, HOLE_DEPTH, false);
    }
    // Where the pair is not: between the two when they stand well apart, the open side when they do not.
    const hole = away();
    if (atNet(a) && atNet(b) && !inTheAir && myNetDistance > NET_LINE) {
      // Both at the net: over them, at their feet, or low through the hole.
      if (rng.chance(0.3 + level.lobChance)) return shot(clamp(between + rng.range(-0.35, 0.35), -1, 1), 1, true);
      if (rng.chance(level.dropChance * 2.5)) return shot(between, 0.1, false);
      return shot(hole, rng.range(0.3, 0.5), false, level.power * 0.9);
    }
    if (atBack(a) && atBack(b)) {
      // Both at the back. From the net the short ball is the one. From the back, build: a lob or a
      // chiquita now and then to go up behind it, and otherwise deep into the hole.
      if (myNetDistance < NET_LINE && rng.chance(level.dropChance * 2.5)) return shot(hole, 0.1, false);
      if (!inTheAir && myNetDistance > NET_LINE && rng.chance(level.lobChance * BUILD_LOB)) return shot(clamp(between + rng.range(-0.4, 0.4), -1, 1), 1, true);
      if (rng.chance(level.dropChance * BUILD_DROP)) return shot(between, 0.1, false);
      return shot(hole, rng.range(0.75, 0.95), false);
    }
    // Anything else: into the hole, deep.
    return shot(hole, rng.range(0.7, 0.95), false);
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
