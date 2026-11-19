import type { GameConfig } from '../config';
import { clamp } from '../core/math';
import { teamDir } from './court';
import type { InterceptPlan } from './intercept';
import type { Player } from './player';
import type { Trajectory } from './trajectory';
import type { TeamId } from './types';

/**
 * Doubles as padel is played: a pair is two players tied together.
 *
 *   - Up and down together. Both at the net or both at the back, never one of
 *     each: the hole between them is where the point is lost.
 *   - Nobody waits half way. Between the net and the back there is no man's
 *     land: the ball comes at the feet.
 *   - Sliding with the ball. The pair moves across as a block toward the side
 *     the ball is on: whoever is on that side covers the line, the other one
 *     closes the middle.
 *   - Every ball has an owner, and it is known before it arrives. The one on
 *     its side plays it. Through the middle it belongs to whoever has the
 *     forehand toward it (for two right-handers, the one on the left). Only
 *     when the owner cannot get there, or when a lob goes over the head of
 *     somebody at the net, does the other one take it, and it says so.
 *
 * A pair with a person in it is led by the person: the computer partner goes
 * up when the person goes up and back when the person goes back. It never
 * opens the hole itself, and it never takes a ball of the person's without
 * saying so first.
 */

/** Closer to the net than this, a player is at the net. Further than `BACK_LINE`, at the back. */
export const NET_LINE = 5;
export const BACK_LINE = 6.5;
/**
 * Half the distance between the two of a pair across the court, before the
 * slide: closer together at the net, where the ball through the middle comes
 * fastest, and wider at the back, where the walls give time.
 */
export const LANE = 2.3;
export const LANE_NET = 1.8;
/** How much of the ball's position across the court the pair slides, and how far at most. */
export const SLIDE = 0.3;
export const SLIDE_MAX = 1.2;
/** A ball this close to the middle of the pair goes "through the middle". */
export const MIDDLE_BAND = 0.9;
/** A ball this close to the middle of the pair is worth a word: whose it is. */
export const CALL_BAND = 1.7;
/** The other one covers a ball its partner cannot get to only with at least this much time to spare. */
const COVER_SLACK = 0.15;
/** A ball through the middle goes to the other one, not the forehand, if it gets there this much more comfortably. */
const MIDDLE_MARGIN = 0.3;
/** What a person is taken to need to read a ball, when the computer weighs who gets there. */
const PERSON_REACTION = 0.25;
/** A lob over somebody at the net is taken by the partner only if it gets there this much more comfortably. */
const SWITCH_MARGIN = 0.25;
/** A person who is going back this fast (m/s) is going for the lob itself. */
const RETREATING = 1;
/** Seconds a person has to stay at the back before the partner drops back too. */
const DROP_AFTER = 0.4;
/** Going away from the net this fast (m/s) is running to the back, not a step back to hold the net. */
const RUNNING_BACK = 2.5;

/** What a player tells its partner, out loud on a court and with the body here. Always true. */
export type CallKind =
  /** It is going for this one: "¡mía!". */
  | 'mine'
  /** This one through the middle is the partner's: "¡tuya!". */
  | 'yours'
  /** It crosses behind the partner for a lob that went over the partner's head: "¡voy!". */
  | 'switch'
  /** Its lob got past the other pair: "¡arriba!", up to the net together. */
  | 'up'
  /** A lob over both of them: "¡atrás!", back together. */
  | 'back';

/** Why the owner of a ball is who it is. */
export type OwnerReason = 'alone' | 'side' | 'middle' | 'cover' | 'switch';

/** How a computer player of a pair is out of place for an exchange (see `Player.astray`). */
export type Astray = 'stay' | 'halfway';

/** Where somebody stuck in no man's land stands, in metres from the net. */
export const HALFWAY = 5.8;

/**
 * How often a pair of computer players comes apart, for somebody with no
 * composure at all and no strain (see `disorderChance`):
 *   stay      the pair goes up (or back) and it does not follow;
 *   halfway   it follows, and stops in no man's land;
 *   doubt     a ball through the middle, and both hesitate for `doubtTime` s;
 *   hole      the same, for a ball into the hole of a pair out of place: one
 *             that passes further than `holeGap` m from both of them. Nobody
 *             knows whose it is: they hesitate for `holeTime` s, and
 *   neither   of those doubts, how often nobody goes at all: they look at
 *             each other and the ball goes between them.
 * Whoever is out of place and gets a ball of its own is caught flat-footed
 * for `caught` s. A ball "into the hole" never passes within `holeGap` m of
 * either of them while it can be hit (see `closestPass`).
 */
export const DISORDER = { stay: 0.3, halfway: 0.2, doubt: 0.35, hole: 0.9, neither: 0.5, doubtTime: 0.3, holeTime: 0.5, holeGap: 2.2, caught: 0.3 };

export interface PairState {
  /** Where the pair waits: both at the net or both at the back. */
  home: 'net' | 'back';
  /** Since when the person of the pair has been standing at the back, for the partner to follow it there. */
  backSince: number;
  /** The ball the owner was chosen for, and why it is that one's. */
  trajId: number;
  why: OwnerReason;
  /** How far from the middle of the pair the ball goes, across the court (metres, world x). */
  offMiddle: number;
  /** The partner has taken its second look at this ball (see `secondLook`). */
  switchChecked: boolean;
  /** The ball the two of a pair of computer players doubted over, or -1. */
  doubted: number;
}

export function createPairState(): PairState {
  return { home: 'back', backSince: -1, trajId: -1, why: 'alone', offMiddle: 0, switchChecked: false, doubted: -1 };
}

const depthOf = (player: Player): number => Math.abs(player.y);

/** True when the middle of the pair is on the forehand side of `player`. */
function forehandToMiddle(player: Player, middle: number): boolean {
  return (middle - player.x) * player.hand * teamDir(player.team) > 0;
}

/**
 * Where across the court the ball reaches the pair: where it crosses the
 * line the two of them are standing on, or the last place it can be played
 * if it never gets there. It is what a player sees to know whose ball it is.
 */
export function ballAcross(trajectory: Trajectory, team: TeamId, depth: number, now: number): number {
  const points = trajectory.points;
  let last = -1;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (point.t < now) continue;
    if (point.hittable === team) last = i;
    if (Math.abs(point.y) >= depth && (point.y < 0) === (team === 0)) return point.x;
  }
  if (last >= 0) return points[last]!.x;
  return points.length ? points[points.length - 1]!.x : 0;
}

/**
 * Who of the pair plays the ball that is coming, by the rules of padel, with
 * the contact each of them could make (null when there is none).
 */
export function chooseOwner(
  members: readonly Player[],
  plans: ReadonlyArray<InterceptPlan | null>,
  trajectory: Trajectory,
  now: number,
  state: PairState,
): Player {
  const a = members[0]!;
  const b = members[1]!;
  const team = a.team;
  const middle = (a.x + b.x) / 2;
  const across = ballAcross(trajectory, team, (depthOf(a) + depthOf(b)) / 2, now);
  const off = across - middle;
  state.trajId = trajectory.id;
  state.offMiddle = off;
  state.switchChecked = false;
  const spare = (index: number): number => timeToSpare(plans[index] ?? null, members[index]!);

  let owner: Player;
  if (Math.abs(off) <= MIDDLE_BAND) {
    // Through the middle: the forehand. Both or neither: whoever is closer to the net, which is the attacking one.
    const fa = forehandToMiddle(a, middle);
    const fb = forehandToMiddle(b, middle);
    if (fa !== fb) owner = fa ? a : b;
    else owner = depthOf(a) <= depthOf(b) ? a : b;
    // Unless the other one is clearly better placed for it: then it is the other's, and the calls say so.
    const i = owner === a ? 0 : 1;
    if (spare(1 - i) > spare(i) + MIDDLE_MARGIN) owner = members[1 - i]!;
    state.why = 'middle';
  } else {
    owner = Math.sign(off) === Math.sign(a.x - middle) ? a : b;
    state.why = 'side';
  }

  const i = owner === a ? 0 : 1;
  const other = members[1 - i]!;
  const mine = plans[i] ?? null;
  if (spare(i) < 0 && spare(1 - i) >= COVER_SLACK) {
    // It cannot get there; the other one can, and goes.
    state.why = 'cover';
    return other;
  }
  // A lob over the head of an owner at the net, to be played after it bounces behind it: the
  // partner may cross for it. With a person as the owner that waits until the person has had
  // a moment to show what it does (see `secondLook`).
  if (!owner.manual && isLobOver(owner, mine) && spare(1 - i) >= COVER_SLACK && spare(1 - i) >= spare(i) + SWITCH_MARGIN) {
    state.why = 'switch';
    state.switchChecked = true;
    return other;
  }
  return owner;
}

/**
 * Seconds to spare for a contact, counting the moment the player needs to
 * read the ball before it starts to run. A person is given an ordinary
 * reaction. -1 when there is no contact, or not in time.
 */
function timeToSpare(plan: InterceptPlan | null, player: Player): number {
  if (!plan || !plan.reachable) return -1;
  return plan.slack - (player.manual ? PERSON_REACTION : player.reaction);
}

/** A ball that goes over the head of `player` at the net and is to be played after it bounces behind it. */
function isLobOver(player: Player, plan: InterceptPlan | null): boolean {
  if (depthOf(player) >= NET_LINE || !plan) return false;
  return plan.kind !== 'volley' && Math.abs(plan.y) > depthOf(player) + 3;
}

/**
 * The partner's second look, once it has read the ball: if the owner is not
 * going to get there and the partner is, the partner covers it; and a lob
 * over the head of a person at the net, if the person is not already on its
 * way back for it, the partner crosses for. `plans` are the contacts each of
 * them could make from where they are now. Returns the new owner, or null to
 * leave things as they are. It looks once per ball.
 */
export function secondLook(
  members: readonly Player[],
  owner: Player,
  plans: ReadonlyArray<InterceptPlan | null>,
  state: PairState,
): Player | null {
  if (state.switchChecked) return null;
  state.switchChecked = true;
  const index = members.indexOf(owner);
  const other = members[index === 0 ? 1 : 0];
  if (!other) return null;
  const mine = plans[index] ?? null;
  const theirs = plans[index === 0 ? 1 : 0] ?? null;
  if (!theirs || !theirs.reachable || theirs.slack < COVER_SLACK) return null;
  // Both are moving by now: what is left is the running.
  if (!mine || !mine.reachable) {
    state.why = 'cover';
    return other;
  }
  if (!owner.manual || !isLobOver(owner, mine)) return null;
  const retreating = -owner.vy * teamDir(owner.team) > RETREATING;
  if (retreating) return null;
  if (theirs.slack < (mine?.reachable ? mine.slack : -1) + SWITCH_MARGIN) return null;
  state.why = 'switch';
  return other;
}

/**
 * A pair with a person in it waits where the person does: at the net if the
 * person is at the net, at the back once the person has stayed at the back
 * for a moment. Half way, nothing changes: it is on its way somewhere.
 */
export function followPerson(state: PairState, person: Player, now: number): void {
  const depth = depthOf(person);
  const forward = person.vy * teamDir(person.team);
  if (forward < -RUNNING_BACK && depth > NET_LINE - 1) {
    // Running to the back (after a lob, typically): the partner goes back with it, now.
    state.home = 'back';
    state.backSince = -1;
    return;
  }
  if (depth < NET_LINE) {
    state.home = 'net';
    state.backSince = -1;
    return;
  }
  if (depth > BACK_LINE && forward < RETREATING) {
    if (state.backSince < 0) state.backSince = now;
    if (now - state.backSince >= DROP_AFTER) state.home = 'back';
    return;
  }
  state.backSince = -1;
}

/**
 * Where a player of a pair waits for the next ball: at the pair's depth, on
 * its side, with the pair slid toward the ball. Next to a person it stays on
 * the other side of the person, wherever the person has gone.
 */
export function pairSpot(
  me: Player,
  partner: Player,
  state: PairState,
  ballX: number,
  config: GameConfig,
  out: { x: number; y: number },
): void {
  const dir = teamDir(me.team);
  const slide = clamp(ballX * SLIDE, -SLIDE_MAX, SLIDE_MAX);
  if (partner.manual && !me.manual) {
    // The person may have crossed: take the side it left.
    const personSide = partner.x - slide;
    if (personSide * me.lane > 0.6) me.lane = (personSide > 0 ? -1 : 1) as 1 | -1;
  }
  // Out of place for this exchange: where it stayed, or half way.
  const home = me.astray === 'stay' ? me.astrayHome : state.home;
  const net = home === 'net';
  const depth = me.astray === 'halfway' ? HALFWAY : net ? config.player.homeNet : config.player.homeBack;
  out.x = slide + me.lane * (net ? LANE_NET : LANE);
  out.y = -dir * depth;
}

/**
 * Doubles, a pair of computer players: how likely it is to come apart at a
 * moment of change, 0..1. A player without composure, deep into a point that
 * has been hard on it, is the one who stays behind, stops half way or doubts.
 * `base` is the chance for somebody with no composure at all and no strain.
 */
export function disorderChance(base: number, composure: number, strain: number): number {
  return clamp(base * (1 - composure) * (1 + Math.min(strain, STRAIN_CAP)), 0, 0.9);
}

/** Strain counts toward coming apart up to this much (it doubles the chance at most). */
const STRAIN_CAP = 1;

/**
 * How close the ball comes to where `player` stands, while its team may hit
 * it and low enough to be reached with a racket. A ball into the hole of a
 * pair is one that passes far from both of them: over the head of the one at
 * the net, between the two, out of reach of either.
 */
export function closestPass(trajectory: Trajectory, player: Player, now: number, highest: number): number {
  let best = Infinity;
  for (const point of trajectory.points) {
    // On its way in: once it comes off a wall, the one at the back has it anyway.
    if (point.walls > 0) break;
    if (point.t < now || point.hittable !== player.team || point.z > highest) continue;
    const gap = Math.hypot(point.x - player.x, point.y - player.y);
    if (gap < best) best = gap;
  }
  return best;
}

/** The side of the court a player of a pair plays on to begin with: index 0 is the right, seen from its own end. */
export function startingLane(team: TeamId, index: number): 1 | -1 {
  return (index === 0 ? teamDir(team) : -teamDir(team)) as 1 | -1;
}
