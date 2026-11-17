import type { CourtConfig } from '../config';
import type { BallEvent } from './ball';
import { inServiceBox, sideOf } from './court';
import { otherTeam, type TeamId } from './types';

/**
 * The state of the ball in play, from the point of view of the rules.
 * It is a small plain object on purpose: the trajectory prediction clones it
 * and replays the rules on the future of the ball.
 */
export interface RallyState {
  live: boolean;
  /** Team that struck the ball last. */
  hitter: TeamId;
  /** The ball comes from a serve that has not been returned yet. */
  isServe: boolean;
  /** Sign of x of the service box the serve has to land in. */
  serveBox: 1 | -1;
  /** Bounces on the floor of the receiving half since the last hit. */
  bounces: number;
  /** The ball touched the net since the last hit. */
  netTouched: boolean;
}

export type PointReason =
  | 'doubleBounce' // the ball bounced twice
  | 'net' // stayed in the net
  | 'ownSide' // bounced on the hitter's half
  | 'wall' // hit the opponent's glass before bouncing
  | 'fence' // hit a fence before bouncing
  | 'out' // flew out of the court before bouncing
  | 'outAfterBounce' // left the court after a good bounce
  | 'overNet' // came back over the net untouched after a good bounce
  | 'doubleFault';

export type FaultReason = 'box' | 'net' | 'wall' | 'fence' | 'out';

export type RallyResult =
  | { kind: 'point'; winner: TeamId; reason: PointReason }
  | { kind: 'fault'; reason: FaultReason }
  | { kind: 'let' };

export function createRally(): RallyState {
  return { live: false, hitter: 0, isServe: false, serveBox: 1, bounces: 0, netTouched: false };
}

export function copyRally(from: RallyState, to: RallyState): void {
  to.live = from.live;
  to.hitter = from.hitter;
  to.isServe = from.isServe;
  to.serveBox = from.serveBox;
  to.bounces = from.bounces;
  to.netTouched = from.netTouched;
}

/** Registers a hit: the ball now belongs to `team` and has to reach the other half. */
export function registerHit(rally: RallyState, team: TeamId, isServe: boolean, serveBox: 1 | -1): void {
  rally.live = true;
  rally.hitter = team;
  rally.isServe = isServe;
  rally.serveBox = serveBox;
  rally.bounces = 0;
  rally.netTouched = false;
}

/**
 * May `team` strike the ball right now?
 * The ball has to be on its half, the opponents must have hit it last, and a
 * serve can only be returned after it bounced (no volley on the return).
 */
export function canHit(rally: RallyState, team: TeamId, ballY: number): boolean {
  if (!rally.live || rally.hitter === team) return false;
  if (sideOf(ballY) !== team) return false;
  return rally.isServe ? rally.bounces === 1 : rally.bounces <= 1;
}

/**
 * Feeds one ball event to the rules. Returns the outcome when the event ends
 * the point (or the serve), otherwise null.
 */
export function applyBallEvent(
  rally: RallyState,
  event: BallEvent,
  court: CourtConfig,
): RallyResult | null {
  if (!rally.live) return null;
  const hitter = rally.hitter;
  const receiver = otherTeam(hitter);
  const wins = (reason: PointReason): RallyResult => ({ kind: 'point', winner: hitter, reason });
  const loses = (reason: PointReason): RallyResult => ({ kind: 'point', winner: receiver, reason });
  const fault = (reason: FaultReason): RallyResult => ({ kind: 'fault', reason });

  switch (event.type) {
    case 'net':
      rally.netTouched = true;
      return null;

    case 'cross':
      // After a good bounce the receiver has to play it before it flies back over the net.
      if (rally.bounces >= 1 && event.toSide === hitter) return wins('overNet');
      return null;

    case 'floor': {
      if (rally.bounces >= 1) return wins('doubleBounce');
      if (sideOf(event.y) === hitter) {
        if (rally.isServe) return fault(rally.netTouched ? 'net' : 'box');
        return loses(rally.netTouched ? 'net' : 'ownSide');
      }
      if (rally.isServe) {
        if (!inServiceBox(court, event.x, event.y, receiver, rally.serveBox)) return fault('box');
        if (rally.netTouched) return { kind: 'let' };
      }
      rally.bounces = 1;
      // A ball that is already rolling will never be playable again.
      return event.rolling ? wins('doubleBounce') : null;
    }

    case 'wall': {
      if (rally.bounces >= 1) {
        // A serve that bounces in and then reaches the fence is a fault; the glass is fine.
        if (rally.isServe && event.surface === 'fence') return fault('fence');
        return null;
      }
      if (rally.isServe) return fault(event.surface === 'fence' ? 'fence' : 'wall');
      if (sideOf(event.y) === receiver) return loses(event.surface === 'fence' ? 'fence' : 'wall');
      // On the hitter's own half the glass may be used to send the ball over; the fence may not.
      return event.surface === 'fence' ? loses('fence') : null;
    }

    case 'out':
      if (rally.bounces >= 1) return wins('outAfterBounce');
      return rally.isServe ? fault('out') : loses('out');
  }
}
