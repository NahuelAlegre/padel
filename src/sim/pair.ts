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
 * takes a ball of the person's without saying so first.
 *
 * A ball that comes at somebody is that one's, whatever the side or the
 * middle say: nobody watches a ball go past their own body because the
 * partner has the forehand to it. And nobody stops looking once the ball is
 * on its way: if the one whose ball it is is not getting there and it is
 * coming to the other one, the other one takes it, and says so.
 *
 * How each one shares the court is its attitude (see `ATTITUDE`): the
 * aggressive one goes up, calls the partner up and now and then takes a ball
 * it plays better; the passive one stays back and leaves what is doubtful.
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
/**
 * A ball that passes this close to one of the pair (metres from where it
 * stands, while it can be hit: a step at most) and at least `BODY_MARGIN`
 * further from the other comes at that one: it is that one's, side and
 * middle aside.
 */
export const BODY_REACH = 1.3;
export const BODY_MARGIN = 0.9;
/** A ball this close to the middle of the pair is worth a word: whose it is. */
export const CALL_BAND = 1.7;
/** The other one covers a ball its partner cannot get to only with at least this much time to spare. */
export const COVER_SLACK = 0.15;
/**
 * Watching a ball of the partner's that comes its way, a player takes it once
 * it is this close (seconds) to its own contact and the partner is still not
 * on its way to it: before that, the partner may yet go.
 */
export const COVER_COMMIT = 0.8;
/** A person moving slower than this (m/s) is not on its way anywhere. */
const GOING = 0.8;
/** A ball through the middle goes to the other one, not the forehand, if it gets there this much more comfortably. */
const MIDDLE_MARGIN = 0.3;
/** What a person is taken to need to read a ball, when the computer weighs who gets there. */
const PERSON_REACTION = 0.25;
/** A lob over somebody at the net is taken by the partner only if it gets there this much more comfortably. */
const SWITCH_MARGIN = 0.25;
/** A person who is going back this fast (m/s) is going for the lob itself. */
const RETREATING = 1;
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

/**
 * Why the owner of a ball is who it is:
 *   alone   nobody else to play it
 *   side    it goes to its side of the pair
 *   body    it comes at it
 *   middle  through the middle, and it has the forehand to it (or the other leaves it)
 *   cover   the other one was not getting there
 *   switch  a lob over the other one, at the net
 *   steal   the other one's, and it went for it saying so (see `Attitude`)
 */
export type OwnerReason = 'alone' | 'side' | 'body' | 'middle' | 'cover' | 'switch' | 'steal';

/**
 * How a player shares the court with its partner. It is chosen for the
 * person's partner and every computer player has one of its own:
 *   aggressive  goes up a lot, calls the partner up behind its own attacking
 *               shots, finishes everything over its head and now and then
 *               takes a ball of the partner's that it plays better, always
 *               saying «¡mía!» first. Sometimes it is wrong to.
 *   balanced    plays its side and the middle by the rule, and covers what
 *               the partner is not getting to.
 *   passive     stays back, plays only its own and leaves the doubtful
 *               ones: the middle, and what does not come right at it.
 */
export type Attitude = 'aggressive' | 'balanced' | 'passive';

export const ATTITUDES: readonly Attitude[] = ['aggressive', 'balanced', 'passive'];

export interface AttitudeRules {
  /** A ball through the middle: 1 it goes for it, -1 it leaves it to the partner, 0 by the rule (the forehand). */
  middle: -1 | 0 | 1;
  /**
   * Next to a person: it goes up with the person once the person is this
   * close to the net (metres), and back once the person has stayed at the
   * back for `dropAfter` seconds.
   */
  upAt: number;
  dropAfter: number;
  /** Behind an attacking shot of its own it goes up even with the person at the back, and calls the person up. */
  leads: boolean;
  /** A ball the partner is not getting to is covered only if it comes this close (metres) to where it stands. */
  coverFrom: number;
}

export const ATTITUDE: Record<Attitude, AttitudeRules> = {
  aggressive: { middle: 1, upAt: 6.2, dropAfter: 0.9, leads: true, coverFrom: 2.6 },
  balanced: { middle: 0, upAt: NET_LINE, dropAfter: 0.4, leads: false, coverFrom: 2.2 },
  passive: { middle: -1, upAt: 4.2, dropAfter: 0.15, leads: false, coverFrom: 1.3 },
};

/** A loose way to write an attitude, as people do (agresivo, agresiva, aggressive...), or null. */
export function attitudeFrom(value: string | null | undefined): Attitude | null {
  if (!value) return null;
  const word = value.toLowerCase();
  if (word.startsWith('agres') || word === 'aggressive') return 'aggressive';
  if (word.startsWith('equil') || word === 'balanced') return 'balanced';
  if (word.startsWith('pasiv') || word === 'passive') return 'passive';
  return null;
}

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
  /**
   * Next to a person: the computer player that went up on its own behind an
   * attacking shot and called the person up (see `AttitudeRules.leads`), or
   * -1. It lasts until the person plays a ball, or a lob goes over it.
   */
  leader: number;
}

export function createPairState(): PairState {
  return { home: 'back', backSince: -1, trajId: -1, why: 'alone', offMiddle: 0, switchChecked: false, doubted: -1, leader: -1 };
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
 * the contact each of them could make (null when there is none). `highest`
 * is the highest ball anybody can hit.
 */
export function chooseOwner(
  members: readonly Player[],
  plans: ReadonlyArray<InterceptPlan | null>,
  trajectory: Trajectory,
  now: number,
  state: PairState,
  highest: number,
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
  const passA = closestPass(trajectory, a, now, highest);
  const passB = closestPass(trajectory, b, now, highest);

  let owner: Player;
  if (Math.min(passA, passB) <= BODY_REACH && Math.abs(passA - passB) >= BODY_MARGIN) {
    // It comes at one of them: that one's, whatever the side or the middle say.
    owner = passA < passB ? a : b;
    state.why = 'body';
  } else if (Math.abs(off) <= MIDDLE_BAND) {
    // Through the middle: the forehand. Both or neither: whoever is closer to the net, which is the attacking one.
    const fa = forehandToMiddle(a, middle);
    const fb = forehandToMiddle(b, middle);
    if (fa !== fb) owner = fa ? a : b;
    else owner = depthOf(a) <= depthOf(b) ? a : b;
    // Their attitudes may say otherwise: the keen one goes for it, the passive one leaves it. Next to a
    // person only leaving counts: the computer player's keenness is for its own calls (see `Attitude`).
    const keen = (player: Player): number => {
      const lean = ATTITUDE[player.attitude].middle;
      return lean > 0 && (a.isHuman || b.isHuman) ? 0 : lean;
    };
    if (keen(a) !== keen(b)) owner = keen(a) > keen(b) ? a : b;
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
  return plan.slack - (player.manual ? PERSON_REACTION : player.read);
}

/** A ball that goes over the head of `player` at the net and is to be played after it bounces behind it. */
function isLobOver(player: Player, plan: InterceptPlan | null): boolean {
  if (depthOf(player) >= NET_LINE || !plan) return false;
  return plan.kind !== 'volley' && Math.abs(plan.y) > depthOf(player) + 3;
}

/**
 * The partner's second look, once it has read the ball: a lob over the head
 * of a person at the net, if the person is not already on its way back for
 * it, the partner crosses for. `plans` are the contacts each of them could
 * make from where they are now. Returns the new owner, or null to leave
 * things as they are. It looks once per ball; covering a ball the owner is
 * not getting to is looked at all along (see `shouldCover`).
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
  if (!owner.manual || !mine || !mine.reachable || !isLobOver(owner, mine)) return null;
  const retreating = -owner.vy * teamDir(owner.team) > RETREATING;
  if (retreating) return null;
  if (theirs.slack < mine.slack + SWITCH_MARGIN) return null;
  state.why = 'switch';
  return other;
}

/** A ball the person can play about as soon as the partner covering it could: it is still the person's. */
const COVER_LATER = 0.35;

/**
 * Whether `watcher`, a computer player, takes a ball that is its partner's
 * (`owner`), because the partner is not getting there. People keep an eye on
 * the ball all along, and so does it:
 *   - a computer partner whose run to the ball falls short;
 *   - a person whose best run would fall short, wherever the ball goes;
 *   - a ball that comes to the watcher (within its attitude's `coverFrom` of
 *     where it stands) once its own contact is `COVER_COMMIT` away, if by
 *     then it comes right at the watcher and clearly not at the person, as
 *     it would have been the watcher's from the start; or if the person is
 *     not on its way to it. Until then the person may yet go. A passive one
 *     covers only what the person is not on its way to.
 * Never a ball the person is about to play first.
 * `mine` is the watcher's run to the ball from where it is, `run` the
 * owner's best run, and `near` the contact the owner can make from where it
 * stands (for a person: null when the ball does not pass within its reach).
 * `speed` and `reach` are the owner's.
 */
export function shouldCover(
  watcher: Player,
  owner: Player,
  mine: InterceptPlan | null,
  run: InterceptPlan | null,
  near: InterceptPlan | null,
  now: number,
  speed: number,
  reach: number,
): boolean {
  if (!mine || !mine.reachable || mine.slack < COVER_SLACK) return false;
  if (!run || !run.reachable) return true;
  if (!owner.manual) return false;
  const rules = ATTITUDE[watcher.attitude];
  if (Math.hypot(mine.stanceX - watcher.x, mine.stanceY - watcher.y) > rules.coverFrom) return false;
  if (mine.t - now > COVER_COMMIT) return false;
  // It passes within the person's reach about as soon: the person's. A passive one leaves it to the person anyway.
  if (near && (watcher.attitude === 'passive' || near.t <= mine.t + COVER_LATER)) return false;
  return !onItsWay(owner, mine, now, speed, reach);
}

/**
 * A ball of the person's that has come to be at `watcher`: it passes within
 * a step of where the watcher stands (`stand` is that contact), clearly not
 * at the person, and soon (`COVER_COMMIT`), with the person not about to
 * play it first (`near`, the person's contact from where it stands). It is
 * the watcher's, as it would have been from the start (see `BODY_REACH`):
 * anybody stops and plays the ball that comes at them. A passive player
 * leaves even those to its partner.
 *
 * And at the last moment (`LAST_MOMENT` before it goes by within reach) a
 * ball the person is not going to get to, whatever its attitude: nobody
 * watches the point go by a racket's length away.
 * `speed` and `reach` are the person's.
 */
export function cameToIt(
  watcher: Player,
  owner: Player,
  stand: InterceptPlan | null,
  near: InterceptPlan | null,
  now: number,
  speed: number,
  reach: number,
): boolean {
  if (!stand || stand.t - now > COVER_COMMIT || stand.t - now < COVER_LEAST) return false;
  if (near && near.t <= stand.t) return false;
  if (stand.t - now <= LAST_MOMENT && !near && !onItsWay(owner, stand, now, speed, reach)) return true;
  if (watcher.attitude === 'passive') return false;
  const mine = Math.hypot(stand.x - watcher.x, stand.y - watcher.y);
  const theirs = Math.hypot(stand.x - owner.x, stand.y - owner.y);
  return mine <= BODY_REACH && theirs >= mine + BODY_MARGIN;
}

/** How long before a ball goes by within reach a player puts the racket there if its partner is not going to. */
export const LAST_MOMENT = 0.3;
/** Taking a ball of the partner's needs at least this long (seconds) before the contact: to say so, and to swing. */
const COVER_LEAST = 0.12;

/**
 * A person on its way to where the ball will be met: going the way it is
 * going, at the pace it is going (never faster than `speed`), it passes
 * within reach of it before the ball gets there. What somebody next to it
 * would see, not what the person means to do.
 */
export function onItsWay(person: Player, contact: InterceptPlan, now: number, speed: number, reach: number): boolean {
  const dx = contact.x - person.x;
  const dy = contact.y - person.y;
  if (Math.hypot(dx, dy) <= reach) return true;
  const pace = Math.hypot(person.vx, person.vy);
  if (pace < GOING) return false;
  // Along the way it is running, up to where it gets by the time the ball does: how close it comes.
  const run = Math.min(pace, speed) * Math.max(0, contact.t - now);
  const ux = person.vx / pace;
  const uy = person.vy / pace;
  const along = clamp(dx * ux + dy * uy, 0, run);
  return Math.hypot(dx - ux * along, dy - uy * along) <= reach + ON_ITS_WAY_MARGIN;
}

/** A person whose run passes this close (metres) to within reach of the ball counts as getting there. */
const ON_ITS_WAY_MARGIN = 0.25;

/**
 * A pair with a person in it waits where the person does: at the net if the
 * person is at the net, at the back once the person has stayed at the back
 * for a moment. Half way, nothing changes: it is on its way somewhere. How
 * close to the net and how long at the back is the partner's attitude.
 */
export function followPerson(state: PairState, person: Player, now: number, rules: AttitudeRules = ATTITUDE.balanced): void {
  const depth = depthOf(person);
  const forward = person.vy * teamDir(person.team);
  if (forward < -RUNNING_BACK && depth > NET_LINE - 1) {
    // Running to the back (after a lob, typically): the partner goes back with it, now.
    state.home = 'back';
    state.backSince = -1;
    return;
  }
  if (depth < rules.upAt) {
    state.home = 'net';
    state.backSince = -1;
    return;
  }
  if (depth > BACK_LINE && forward < RETREATING) {
    if (state.backSince < 0) state.backSince = now;
    if (now - state.backSince >= rules.dropAfter) state.home = 'back';
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
  // Out of place for this exchange: where it stayed, or half way. Up on its own, calling the person up: at the net.
  const home = me.astray === 'stay' ? me.astrayHome : state.leader === me.id ? 'net' : state.home;
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
