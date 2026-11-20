import { SIM_DT, type AILevel, type GameConfig } from '../config';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import { planIntercept, stanceAt, type InterceptPlan } from '../sim/intercept';
import type { Controller, Match } from '../sim/match';
import { BACK_LINE, NET_LINE } from '../sim/pair';
import { lungeReach, playerReach, playerSpeed, travelTime, type Player } from '../sim/player';
import { pointAt } from '../sim/trajectory';
import { otherTeam, type PlayerIntent, type ShotIntent, type SwingWhy } from '../sim/types';
import { zoneFacing, type Facing } from '../sim/zones';
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
/**
 * Doubles, against a pair split in two (one at the net, one at the back):
 * from the back, how often it lobs the one at the net; from the net, how
 * often it plays at that one's feet, short. Otherwise into the hole: a ball
 * that goes by the one at the net further than its racket gets (`HOLE_CLEAR`
 * metres past its reach and a stride), and lands as far as it can from the
 * one at the back (docs/red.md).
 */
const SPLIT_LOB = 0.4;
const SPLIT_FEET = 0.4;
const HOLE_CLEAR = 0.4;
/**
 * The hole past the racket of the one at the net is played only against a
 * pair with a person in it. Between two pairs of computer players everything
 * stays as it was, and so do the demo and the studio: with the demo this
 * change makes, the studio finds a low ball whose pose the animation does not
 * solve yet (docs/red.md). Turn it off once that is solved. Two computer
 * players split in two get, as before, a lob over the one at the net or a
 * ball between them, `HOLE_DEPTH` (0..1) deep.
 */
const PERSON_PAIRS_ONLY = true;
const HOLE_DEPTH = 0.35;
/**
 * Reading a habit: a person who stays at the net when a lob goes over it is
 * lobbed again, over its head, by anybody: it is there for all to see. Every
 * time it stays adds `HABIT_LOB` to how often (up to `HABIT_MOST`), on top of
 * the lobs each one plays anyway; every time it goes back takes one away
 * (docs/red.md). A lob is "over" the one at the net nearest across the court
 * to where it bounces.
 */
const HABIT_LOB = 0.2;
const HABIT_MOST = 0.6;
/** Doubles: how often even somebody who never goes to the net goes up behind its serve. */
const DOUBLES_SERVE_UP = 0.6;
/** Doubles, both pairs at the back: how much more than its taste a player lobs and plays short, to go up. */
const BUILD_LOB = 1;
const BUILD_DROP = 1.5;

/**
 * How demanding a ball is (see `demandOf`): what the other side did to it.
 *   the ball itself   its pressure where it is met: low at the net, at the
 *                     floor, fast, stretched, cramped in a corner, over the
 *                     head of somebody going back, aimed close to the lines
 *   tight             how little time the placement and the pace leave: what
 *                     is left to spare after reading it with an ordinary
 *                     reaction (`READ_AS`, not its own: its slowness is not
 *                     the other side's doing) and running there on its own
 *                     legs. Nothing above `TIGHT` seconds, all of it at
 *                     `TIGHT - TIGHT_SPAN`. A ball it was handed late (its
 *                     partner's, that the partner was not going for) counts
 *                     from when it was handed, and from where it was then
 *   change            a change of pace from the last ball it played, all of
 *                     it at `PACE_CHANGE` m/s
 *   surprise          how much longer than its reaction it took to read it
 * Each counts this much, and the sum is cut at `MOST`.
 */
const DEMAND = { tight: 0.6, change: 0.3, surprise: 0.4 } as const;
const READ_AS = 0.25;
const TIGHT = 0.15;
const TIGHT_SPAN = 0.3;
const PACE_CHANGE = 8;
const MOST = 1.5;
/**
 * What a demanding ball does to a swing, and what a comfortable one does. It
 * grows with the square of the demand, so an ordinary rally ball hardly moves
 * it and the ball the other side really worked for does: the spread of the
 * timing goes from `COMFORT` of its own (steadier than ever: a comfortable
 * ball is hardly ever missed) to `COMFORT + SPREAD` at a demand of 1, and it
 * comes `LATE` of that spread late; the ball leaves the racket from `CALM` to
 * `CALM + WILD` as wild. So the mistakes are the ones the other side brought
 * about, not the ones a long rally hands out by chance.
 */
const COMFORT = 0.5;
const SPREAD = 3;
const LATE = 1.5;
const CALM = 0.75;
const WILD = 3;

/** A ball becomes its own this long (seconds) after it read it, or later: it was handed late (see `DEMAND`). */
const HANDED_LATE = 0.06;

/** How much a demand bites: its square. */
const bite = (demand: number): number => demand * demand;
/** From this much demand on, the swing counts as forced (for whoever shows or measures it), and the bold may gamble. */
const FORCED = 0.45;
/** A swing that would come after the ball is dead comes this long (seconds) before, instead. */
const LAST_SWING = 4 * SIM_DT;
/**
 * A block of a ball at the body: the racket is put in front of it, so its
 * timing is only a little wider than its hands' usual (`REFLEX_SIGMA` times
 * it: wider than a comfortable ball, and never late); there is no aiming it,
 * and it comes off the racket wilder than usual (`REFLEX_SCATTER`) and softer.
 */
const REFLEX_SIGMA = 1.25;
const REFLEX_SCATTER = 1.3;
const REFLEX_POWER = 0.85;
/**
 * A demanding ball, and it goes for the winner anyway: how often, for the
 * aggressive who do not read the game (aggression × (1 − smart) × this), and
 * how much wilder that ball is.
 */
const GAMBLE = 0.45;
const GAMBLE_SCATTER = 1.6;
/**
 * Doubles: going for a ball of the partner's (see `Attitude`). How much each
 * kind tempts it, times its taste for it (`AILevel.steal`):
 *   high     over its head at the net, where it puts it away
 *   hurried  one the partner gets to rushed, and it would play with time
 *   poach    one the partner lets bounce, that it can volley at the net
 * People who like taking the ball think they get there better than they do:
 * it judges its own time to spare `OVERCONFIDENT` too well, give or take
 * `JUDGE`. Sometimes it is wrong.
 */
const STEAL_HIGH = 0.9;
const STEAL_HURRIED = 0.7;
const STEAL_POACH = 0.35;
const OVERCONFIDENT = 0.1;
const JUDGE = 0.15;
/** It goes for a high ball with this much time to spare as it sees it, for the others with `STEAL_ROOM`. */
const STEAL_HIGH_ROOM = 0.15;
const STEAL_ROOM = 0.35;
/** A partner who gets there with less than this to spare gets there rushed. */
const RUSHED = 0.12;
/**
 * With the hit zones on, the ball at the body of whoever is at the net
 * (docs/zonas.md, `zones.bodyShot`): at most `BODY_NET` from it, and landing
 * this far behind it, so that it goes through at chest height.
 */
const BODY_NET = 4.8;
const BODY_BEHIND = 1.8;
/** With the hit zones on, a ball the other side blocked or slapped late, to be attacked, is finished at least this often. */
const GIFT_PUNISH = 0.7;

/** Doubles: the one at the net of a pair split in two (one at the net, the other at the back), or null. */
function splitFront(pair: readonly Player[]): Player | null {
  const [a, b] = pair;
  if (!a || !b) return null;
  const depthA = Math.abs(a.y);
  const depthB = Math.abs(b.y);
  if (depthA < NET_LINE && depthB > BACK_LINE) return a;
  if (depthB < NET_LINE && depthA > BACK_LINE) return b;
  return null;
}

/** Scratch: where the body sets up, and which way it faces. */
const spot = { x: 0, y: 0 };
const facing: Facing = { x: 0, y: 0 };

/**
 * How demanding the ball of `plan` is for `me` (0 comfortable, about 1
 * demanding, `MOST` at most): what the other side did to it (see `DEMAND`).
 * `waitX`, `waitY` is where it was waiting when the ball was struck, and
 * `lastPace` the speed of the last ball it played (-1 for none). `since`,
 * for a ball it was handed late, is when (and `waitX`, `waitY` where it was).
 */
export function demandOf(match: Match, me: Player, plan: InterceptPlan, waitX: number, waitY: number, lastPace: number, since = -Infinity): number {
  const trajectory = match.trajectory;
  const config = match.config;
  const own = trajectory && trajectory.id === plan.trajId ? trajectory : null;
  const point = own ? pointAt(own, plan.t) : null;
  const pace = point ? Math.hypot(point.vx, point.vy, point.vz) : 0;
  const ball = match.plannedPressure(me, plan);
  const run = travelTime(Math.hypot(plan.stanceX - waitX, plan.stanceY - waitY), playerSpeed(me, config), config.player.accel);
  const left = own ? plan.t - Math.max(own.t0 + READ_AS, since) - run : Infinity;
  const tight = clamp((TIGHT - left) / TIGHT_SPAN, 0, 1);
  const change = lastPace >= 0 && pace > 0 ? clamp(Math.abs(pace - lastPace) / PACE_CHANGE, 0, 1) : 0;
  const surprise = me.reaction > 0 ? clamp(me.read / me.reaction - 1, 0, 1) : 0;
  return clamp(ball + DEMAND.tight * tight + DEMAND.change * change + DEMAND.surprise * surprise, 0, MOST);
}

/**
 * With the hit zones on: the aim (-1..1) and depth (0..1) of an ordinary
 * shot struck at (`fromX`, `fromY`) that goes through somebody standing at
 * (`atX`, `atY`) on the other side, on its way down (docs/zonas.md). It
 * lands `BODY_BEHIND` behind that player and, seen from above, flies in a
 * straight line from where it is struck to where it lands, so it is aimed
 * that much wider to cross where the body is. It reads only where everybody
 * is standing, like anybody on a court.
 */
export function aimAtBody(fromX: number, fromY: number, atX: number, atY: number, config: GameConfig): [number, number] {
  const spec = config.shots.specs.drive;
  const dropAt = config.shots.dropAt;
  const land = clamp(Math.abs(atY) + BODY_BEHIND, spec.depthNear, spec.depthFar);
  const deep = (land - spec.depthNear) / (spec.depthFar - spec.depthNear);
  // Just over what would be a chiquita: an ordinary shot, as short as it gets.
  const depth = dropAt + 0.01 + deep * (1 - dropAt - 0.01);
  const along = (Math.abs(fromY) + Math.abs(atY)) / (Math.abs(fromY) + land);
  const x = fromX + (atX - fromX) / Math.max(0.3, along);
  return [clamp(x / spec.aimRange, -1, 1), depth];
}

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
  /** Doubles: the last ball of its partner's it thought about going for (see `wantsIt`). */
  private looked = -1;
  /** Where it was waiting when the ball that is coming was struck: what it is pulled away from. */
  private waitX = 0;
  private waitY = 0;
  /** Speed of the ball it is waiting for, and of the last one it played (-1 for none): the change of pace. */
  private pace = 0;
  private lastPace = -1;
  /** How demanding the ball in `lastPlan` is (see `demandOf`), when it means to meet it, and whether its body is too late for it. */
  private demand = 0;
  private meetAt = -1;
  private tooLate = false;
  /** With the hit zones on: how far from its spot for the ball in `lastPlan` its feet end up (see `placement`). */
  private missX = 0;
  private missY = 0;
  /** How many times each person of the other side stayed at the net under a lob of this side, net of the times it went back (see `HABIT_LOB`). */
  private readonly stayed = new Map<number, number>();
  /** The lob of this side being watched until it bounces, and who of the other side was at the net when it was struck. */
  private lobTraj = -1;
  private lobSeen = -1;
  private lobUnder: Player[] = [];

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
    this.looked = -1;
    this.lastPace = -1;
    this.demand = 0;
    this.meetAt = -1;
    this.tooLate = false;
    this.missX = 0;
    this.missY = 0;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    const rally = match.rally;
    this.readLobs(match, me);
    // After each of its own shots it decides where to wait for the next ball.
    if (match.rallyHits !== this.seenHits) {
      this.seenHits = match.rallyHits;
      this.pair = match.teams[me.team].length === 2;
      if (rally.live && rally.hitter === me.team) {
        this.ownHits++;
        this.home = this.whereToWait(me);
        if (match.lastHitter[me.team] === me.id) this.lastPace = this.pace;
      } else if (rally.live) {
        // A ball on its way to its side: from here it is pulled, or not.
        this.waitX = me.x;
        this.waitY = me.y;
      }
    }
    // The lob it meant to follow: up it goes when the ball has got past, which is when it bounces.
    if (this.followLob && rally.live && rally.hitter === me.team && rally.bounces >= 1) {
      this.followLob = false;
      this.home = 'net';
    }
    intent.home = this.home;
    autoMove(match, me, intent);
    // With the hit zones on, its feet end up near its spot, not on it (see `placement`).
    if (me.plan && me.plan === this.lastPlan && intent.hasTarget) {
      intent.targetX += this.missX;
      intent.targetY += this.missY;
    }

    if (match.phase === 'serve') {
      if (match.serverId !== me.id) return;
      if (this.serveAt < 0) this.serveAt = match.time + this.level.serveDelay * this.rng.range(0.8, 1.3);
      if (match.time >= this.serveAt) {
        intent.swing = { aim: this.rng.range(-0.9, 0.9), depth: 0.6, lob: false, power: 1 };
        this.serveAt = -1;
      }
      return;
    }

    // Doubles: a ball of the partner's it would rather play. It says so («¡mía!») the moment it decides.
    const trajectory = match.trajectory;
    if (this.pair && this.level.steal > 0 && trajectory && rally.live && rally.hitter !== me.team && trajectory.id !== this.looked) {
      if (match.assigned[me.team] !== me.id && match.pairs[me.team].trajId === trajectory.id && match.time >= trajectory.t0 + me.read) {
        this.looked = trajectory.id;
        if (this.wantsIt(match, me)) intent.claim = true;
      }
    }

    const plan = me.plan;
    if (!plan) {
      this.lastPlan = null;
      this.swingAt = -1;
      this.cue = null;
      return;
    }
    if (plan !== this.lastPlan) {
      // A new contact: decide now how demanding it is and how well this swing
      // will be timed. Whatever had been decided was for another ball.
      this.lastPlan = plan;
      const point = trajectory && trajectory.id === plan.trajId ? pointAt(trajectory, plan.t) : null;
      this.pace = point ? Math.hypot(point.vx, point.vy, point.vz) : 0;
      // A ball of the person's it takes over late (the person was not going for it): from here, and from now.
      const pairState = match.pairs[me.team];
      const handed =
        this.pair &&
        trajectory !== null &&
        (pairState.why === 'switch' || pairState.why === 'cover') &&
        match.time > trajectory.t0 + me.read + HANDED_LATE &&
        match.teams[me.team].some((mate) => mate !== me && mate.manual);
      this.demand = plan.reflex
        ? 0
        : handed
          ? demandOf(match, me, plan, me.x, me.y, this.lastPace, match.time)
          : demandOf(match, me, plan, this.waitX, this.waitY, this.lastPace);
      const at = this.swingTime(plan, this.demand);
      // Its body is not going to get there before the ball is gone (or before it gives up on this
      // contact): it still swings, at the last moment, and misses. Never a player watching the ball go by.
      const last = this.lastSwing(match, plan);
      this.tooLate = at > last;
      this.swingAt = Math.min(at, last);
      this.meetAt = Math.max(plan.t, this.swingAt);
      this.cue = null;
      this.placement(match, me, plan);
    }
    if (this.swingAt < 0) return;
    intent.meetAt = this.meetAt;

    // While the person is learning, it gives one ball back and lets the next one go.
    const letItGo = match.tutorial && this.ownHits >= (match.server.team === me.team ? 2 : 1);
    if (letItGo) {
      if (match.time >= this.swingAt) this.swingAt = -1;
      return;
    }

    // Make up its mind a moment before the ball arrives, and show it.
    const swingNow = match.time >= this.swingAt && match.time >= me.swingLockUntil;
    if (!this.cue && (swingNow || match.time >= plan.t - this.level.tellLead)) {
      const shot = this.chooseShot(match, me, plan);
      // A body that is going to get there too late shows it: it swings where it expected the ball, after it has gone.
      this.cue = this.tooLate ? { ...shot, late: true } : shot;
    }
    intent.cue = this.cue;
    if (swingNow && this.cue) {
      this.swingAt = -1;
      intent.swing = this.cue;
    }
  }

  /**
   * When its body would meet the ball of this contact. A comfortable ball is
   * timed as well as its hands allow; a demanding one (`demand`, see
   * `demandOf`) worse, and late: the other side made it late. A late swing
   * meets the ball late, further on (it comes out weak), or not at all.
   */
  private swingTime(plan: InterceptPlan, demand: number): number {
    const spread = this.level.timingSigma;
    if (plan.reflex) return plan.t + this.rng.gauss() * spread * REFLEX_SIGMA;
    const sigma = spread * (COMFORT + SPREAD * bite(demand));
    return plan.t + spread * LATE * bite(demand) + this.rng.gauss() * sigma;
  }

  /**
   * With the hit zones on (docs/zonas.md): where its feet end up for the
   * contact of `plan`, against the spot the plan runs to.
   *
   * It sets up for the ball it is really going to meet: when its swing is
   * going to come late (`meetAt`), that ball is further on, and so is its
   * body. Somebody late is late with all of it, not standing still with the
   * arm behind: the lateness costs what the timing costs, and the ball is
   * not met behind the feet.
   *
   * And it ends up across from that spot, give or take as much as its hands
   * give: the spread of its timing for this ball (see `zones.place`). A
   * comfortable ball is met well placed, and one the other side made
   * demanding at the body or at full stretch, as a person meets it. A block
   * is played from where it stands. Off, it gets exactly to its spot, and
   * nothing is drawn.
   */
  private placement(match: Match, me: Player, plan: InterceptPlan): void {
    this.missX = 0;
    this.missY = 0;
    const zones = match.config.zones;
    if (!zones.on || plan.reflex) return;
    const trajectory = match.trajectory;
    const own = trajectory && trajectory.id === plan.trajId ? trajectory : null;
    const late = own && this.meetAt > plan.t ? pointAt(own, this.meetAt) : null;
    const point = late ?? (own ? pointAt(own, plan.t) : null);
    if (!point) return;
    if (late) stanceAt(late, me, match.config, spot);
    else {
      spot.x = plan.stanceX;
      spot.y = plan.stanceY;
    }
    // Across the body that meets the ball: too close to it, or too far.
    zoneFacing(me.team, point.vx, point.vy, match.config, facing);
    const dir = me.team === 0 ? 1 : -1;
    const spread = this.level.timingSigma * (COMFORT + SPREAD * bite(this.demand));
    const miss = this.rng.gauss() * Math.min(zones.placeMost, spread * zones.place);
    this.missX = spot.x + facing.y * dir * miss - plan.stanceX;
    this.missY = spot.y - facing.x * dir * miss - plan.stanceY;
  }

  /**
   * The last moment it can swing at this contact: before the ball is dead, and
   * before it would give up on it for a later one (`lateMax` past it). A body
   * that gets there later than this swings then, and misses.
   */
  private lastSwing(match: Match, plan: InterceptPlan): number {
    const trajectory = match.trajectory;
    const alive = trajectory && trajectory.id === plan.trajId && trajectory.end ? trajectory.end.t : Infinity;
    return Math.max(plan.t, Math.min(alive, plan.t + match.config.timing.lateMax) - LAST_SWING);
  }

  /**
   * Doubles: whether it goes for this ball, which is its partner's. Only a
   * player with a taste for it (`AILevel.steal`), and only a ball it plays
   * better: one over its head at the net, one the partner gets to rushed, or
   * one the partner lets bounce that it can volley at the net. It judges its
   * own chances a little too well, like people who like taking the ball.
   */
  private wantsIt(match: Match, me: Player): boolean {
    const trajectory = match.trajectory;
    const owner = match.players[match.assigned[me.team]];
    if (!trajectory || !owner || match.shouldLeave(me.team)) return false;
    const config = match.config;
    const pc = config.player;
    const mine = planIntercept(trajectory, me, match.time, config);
    if (!mine || !mine.reachable) return false;
    const feel = mine.slack + OVERCONFIDENT + this.rng.gauss() * JUDGE;
    const atNet = Math.abs(me.y) < NET_LINE;
    let appetite = 0;
    if (atNet && mine.kind === 'volley' && mine.z >= pc.overheadZ && feel >= STEAL_HIGH_ROOM) {
      appetite = STEAL_HIGH;
    } else if (feel >= STEAL_ROOM) {
      const theirs = owner.manual ? planIntercept(trajectory, owner, match.time, config) : owner.plan;
      if (theirs && theirs.reachable && theirs.slack < RUSHED) appetite = STEAL_HURRIED;
      else if (atNet && !owner.manual && mine.kind === 'volley' && theirs && theirs.kind !== 'volley') appetite = STEAL_POACH;
    }
    return appetite > 0 && this.rng.chance(this.level.steal * appetite);
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
    // A comfortable ball leaves the racket clean; one the other side made demanding, wilder; a block, wild.
    // Hands that are perfect by design (no spread at all: the coach of the lessons) stay as they are.
    const demand = plan === this.lastPlan ? this.demand : 0;
    if (plan.reflex) scatter *= REFLEX_SCATTER;
    else if (level.timingSigma > 0) scatter *= CALM + WILD * bite(demand);
    let why: SwingWhy | undefined = plan.reflex ? 'reflex' : demand >= FORCED ? 'forced' : undefined;
    // The impatient bring their own strain to a point that goes on.
    const tension = level.impatience > 0 ? Math.max(0, match.rallyHits - level.impatientAfter) * level.impatience : 0;
    const shot = (aim: number, depth: number, lob: boolean, power = level.power): ShotIntent => ({
      aim,
      depth,
      lob,
      power,
      scatter,
      tension,
      why,
    });

    // Where the other side is standing decides what is worth playing.
    let netDistance = Infinity;
    for (const opponent of opponents) netDistance = Math.min(netDistance, Math.abs(opponent.y));
    const rivalAtNet = netDistance < RIVAL_AT_NET;
    const rivalAtBack = netDistance > RIVAL_AT_BACK;
    const myNetDistance = Math.abs(plan.y);
    const inTheAir = plan.kind === 'volley';
    // Against a pair split in two, away from the two of them is the hole the one at the net leaves: past its
    // racket. For now only against a pair with a person in it (see `PERSON_PAIRS_ONLY`).
    const front = opponents.length === 2 && (!PERSON_PAIRS_ONLY || opponents.some((player) => player.isHuman)) ? splitFront(opponents) : null;
    const back = front ? (opponents[0] === front ? opponents[1]! : opponents[0]!) : null;
    const away = (): number =>
      front && back ? this.holeOf(match, plan, front, back)[0] : this.awayFrom(opponents, range) * lerp(0.55, 1, level.angle);
    const middle = (): number => rng.range(-0.6, 0.6) * lerp(0.5, 1, level.angle);

    if (plan.reflex) {
      // A ball at the body, before it had read it: the racket goes in front and blocks it back, wherever it goes.
      return shot(middle() * 0.5, rng.range(0.45, 0.7), false, level.power * REFLEX_POWER);
    }

    // A ball the other side made demanding: those who like to hit and do not
    // read the game go for the winner anyway, now and then, and that ball is
    // the one that goes out. Never with a comfortable one.
    if (demand >= FORCED && !inTheAir && !level.lobUnderPressure && rng.chance(level.aggression * (1 - level.smart) * GAMBLE)) {
      why = 'gamble';
      scatter *= GAMBLE_SCATTER;
      return shot(away(), rng.range(0.8, 1), false);
    }
    // Under pressure the percentage play is to lob and win time.
    const pressed = !plan.reachable || plan.slack < 0.12 || plan.z < 0.4;
    if (pressed && !inTheAir) {
      if (level.lobUnderPressure || rng.chance(0.55)) return shot(middle(), 1, true);
      return shot(0, 0.55, false);
    }

    // A coach feeds: a comfortable ball to where the other player is standing.
    if (rng.chance(level.feed)) return shot(toward(), rng.range(0.5, 0.7), false);

    // With the hit zones on, the ball at the body of whoever is at the net: there it can only be
    // blocked (docs/zonas.md). The aggressive play it often, the quiet hardly ever. A ball it has to
    // dig up is not one to hit through anybody.
    if (config.zones.on && plan.z >= config.court.netCenter * 0.6) {
      const target = this.atTheNet(opponents, plan.x);
      if (target && rng.chance(config.zones.bodyShot * level.aggression)) {
        const [aim, depth] = aimAtBody(plan.x, plan.y, target.x, target.y, config);
        return shot(aim, depth, false);
      }
    }

    // A ball that is there to be attacked: close to the net, above the tape
    // and with time. Whoever knows how finishes it: away from the other one
    // (the situation makes it a smash when it is high enough) and, with
    // nobody at the net, not deep, so it dies in the side fence instead of
    // coming back off the glass; or short when the other one is far back.
    // Whoever does not know just puts it back in play.
    const attackable =
      myNetDistance < ATTACK_ZONE && plan.z >= config.court.netCenter + ATTACK_ABOVE_TAPE && plan.slack >= ATTACK_SLACK;
    // With the hit zones on, a ball the other side could only block, or slapped late, comes back floating
    // (docs/zonas.md): it is there for all to see, and even those who never finish a ball go for that one.
    const punish = config.zones.on && this.gift(match, me) ? Math.max(level.punish, GIFT_PUNISH) : level.punish;
    if (attackable) {
      if (!rng.chance(punish)) return shot(middle(), rng.range(0.5, 0.8), false, level.power * SAFE_POWER);
      if (rivalAtBack && plan.z < config.player.overheadZ && rng.chance(level.dropChance * 2.5)) return shot(away(), 0.1, false);
      return shot(away(), rivalAtNet ? rng.range(0.85, 1) : rng.range(FINISH_DEPTH[0], FINISH_DEPTH[1]), false);
    }

    // Somebody who stays at the net under every lob is lobbed again, by anybody: it is there for all to see.
    const camper = this.camperOf(opponents);
    if (camper && !inTheAir && myNetDistance > NET_LINE && rng.chance(this.habit(camper))) {
      return shot(clamp((camper.x / range) * 0.8 + rng.range(-0.2, 0.2), -1, 1), 1, true);
    }

    if (rng.chance(1 - level.smart)) {
      // Not thinking: put it back somewhere in the middle.
      return shot(middle(), rng.range(0.45, 0.85), false);
    }

    if (opponents.length === 2) return this.pairShot(match, plan, opponents, inTheAir, myNetDistance, range, shot, away);

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
    match: Match,
    plan: InterceptPlan,
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
      // A pair split in two: over the one at the net, at its feet, or into the hole it leaves behind.
      const front = atNet(a) ? a : b;
      const back = front === a ? b : a;
      if (PERSON_PAIRS_ONLY && !a.isHuman && !b.isHuman) {
        // Two computer players, as before: over the one at the net, or between them.
        if (!inTheAir && myNetDistance > NET_LINE && rng.chance(0.5)) return shot(aimAt(front.x), 1, true);
        return shot(between, HOLE_DEPTH, false);
      }
      if (!inTheAir && myNetDistance > NET_LINE && rng.chance(SPLIT_LOB)) return shot(aimAt(front.x), 1, true);
      if (myNetDistance < NET_LINE && rng.chance(SPLIT_FEET)) return shot(aimAt(front.x), 0.1, false);
      const [aim, depth] = this.holeOf(match, plan, front, back);
      return shot(aim, depth, false);
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

  /**
   * With the hit zones on: the ball on its way to `me` is one the other side
   * could only block (at the body) or slapped late (past the body). Anybody
   * on the court sees it: the body showed it, and the ball floats.
   */
  private gift(match: Match, me: Player): boolean {
    const other = match.players[match.lastHitter[otherTeam(me.team)]];
    const trajectory = match.trajectory;
    return other !== undefined && trajectory !== null && other.zoneAt === trajectory.t0 && (other.zone === 'body' || other.zone === 'behind');
  }

  /** With the hit zones on: whoever of the other side is at the net, the one closest across the court to `x` if both are. */
  private atTheNet(opponents: readonly Player[], x: number): Player | null {
    let best: Player | null = null;
    for (const opponent of opponents) {
      if (Math.abs(opponent.y) >= BODY_NET) continue;
      if (!best || Math.abs(opponent.x - x) < Math.abs(best.x - x)) best = opponent;
    }
    return best;
  }

  /** How often it lobs `player` for staying at the net under its lobs (see `HABIT_LOB`): 0 for anybody else. */
  private habit(player: Player): number {
    const stayed = this.stayed.get(player.id) ?? 0;
    return stayed > 0 ? Math.min(HABIT_MOST, HABIT_LOB * stayed) : 0;
  }

  /** The person of the other side at the net that has most stayed there under its lobs, or null. */
  private camperOf(opponents: readonly Player[]): Player | null {
    let best: Player | null = null;
    for (const player of opponents) {
      if (Math.abs(player.y) >= NET_LINE || this.habit(player) <= 0) continue;
      if (!best || this.habit(player) > this.habit(best)) best = player;
    }
    return best;
  }

  /**
   * Watches the lobs of its side (its own and its partner's): who of the other
   * side was at the net when one was struck and, when it bounces, whether the
   * one it went over stayed there. Only people have habits to read: what a
   * computer player does under a lob is the moment, not a habit. Draws nothing.
   */
  private readLobs(match: Match, me: Player): void {
    const rally = match.rally;
    const trajectory = match.trajectory;
    if (!trajectory || !rally.live || rally.hitter !== me.team || trajectory.id === this.lobTraj) return;
    const hitter = match.players[match.lastHitter[me.team]];
    if (!hitter || hitter.anim.shot !== 'lob') return;
    const opponents = match.teams[otherTeam(me.team)];
    if (rally.bounces === 0) {
      // Struck a moment ago: who is at the net under it.
      if (this.lobSeen !== trajectory.id) {
        this.lobSeen = trajectory.id;
        this.lobUnder = opponents.filter((player) => player.manual && Math.abs(player.y) < NET_LINE);
      }
      return;
    }
    // It bounced: it went over the one nearest across the court to where it did.
    this.lobTraj = trajectory.id;
    const bounce = trajectory.bounces[0];
    const under = this.lobSeen === trajectory.id ? this.lobUnder : [];
    this.lobUnder = [];
    if (!bounce || under.length === 0) return;
    let over = under[0]!;
    for (const player of under) if (Math.abs(player.x - bounce.x) < Math.abs(over.x - bounce.x)) over = player;
    const before = this.stayed.get(over.id) ?? 0;
    this.stayed.set(over.id, Math.abs(over.y) < NET_LINE ? before + 1 : Math.max(0, before - 1));
  }

  /**
   * Doubles, against a pair split in two: the aim (-1..1) and depth (0..1) of
   * an ordinary shot struck from `plan` that goes by `front`, at the net,
   * further than its racket gets, and lands as far as it can from `back`.
   * Seen from above the ball flies straight from where it is struck to where
   * it lands, so where it crosses the line `front` stands on is known. It
   * reads only where everybody is standing, like anybody on a court.
   */
  private holeOf(match: Match, plan: InterceptPlan, front: Player, back: Player): [number, number] {
    const config = match.config;
    const spec = config.shots.specs.drive;
    const clear = playerReach(front, config) + lungeReach(config) + HOLE_CLEAR;
    const fromY = Math.abs(plan.y);
    let best: [number, number] = [clamp(-Math.sign(front.x) * 0.8, -1, 1), 0.75];
    let bestGap = -Infinity;
    for (let aim = -1; aim <= 1.001; aim += 0.25) {
      for (const depth of [0.3, 0.55, 0.8, 1]) {
        const x = aim * spec.aimRange;
        const y = spec.depthNear + (spec.depthFar - spec.depthNear) * depth;
        const along = (fromY + Math.abs(front.y)) / (fromY + y);
        const crossX = plan.x + (x - plan.x) * along;
        if (Math.abs(crossX - front.x) < clear) continue;
        const gap = Math.hypot(x - back.x, y - Math.abs(back.y)) + this.rng.range(0, 0.6);
        if (gap > bestGap) {
          bestGap = gap;
          best = [aim, depth];
        }
      }
    }
    return best;
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
