import type { GameConfig } from '../config';
import { clamp } from '../core/math';
import { netHeightAt } from './court';

/** A ball as it reaches whoever has to play it. */
export interface BallAsk {
  ballX: number;
  ballY: number;
  ballZ: number;
  /** Speed the ball arrives with. */
  speed: number;
  /** Horizontal distance from the body to the ball, and how far that player can reach with a lunge. */
  gap: number;
  reach: number;
  /** How fast the player is moving away from the net (negative: toward it). */
  retreat: number;
  /** 0..1, how close to the walls the shot that brought it was aimed, when it came off. */
  risk: number;
  /**
   * With the hit zones on (`config.zones.on`, src/sim/zones.ts), 0..1: how
   * much the ball is at the body, and how far past the line of the body.
   * Left out, 0.
   */
  body?: number;
  behind?: number;
}

/** What each thing adds to the pressure of a ball, already weighted. For tools and for whoever shows it. */
export interface PressureParts {
  below: number;
  stretch: number;
  pace: number;
  cramped: number;
  backpedal: number;
  risk: number;
  /** With the hit zones on: at the body, and past the line of the body. */
  body: number;
  behind: number;
}

/**
 * 0..1, how much of a backpedal a contact is: going away from the net under a
 * high ball. A smash needs the feet under it; hit like this it is a bandeja.
 */
export function backpedalOf(retreat: number, ballZ: number, config: GameConfig): number {
  const high = clamp((ballZ - (config.player.overheadZ - 0.4)) / 0.4, 0, 1);
  return clamp(retreat / config.shots.pressure.backpedalSpeed, 0, 1) * high;
}

/**
 * How hard a ball is to play, from 0 (comfortable) to 1.
 *
 *   below     under the tape close to the net, or down at the floor
 *             anywhere: it has to be hit upwards
 *   stretch   far from the body
 *   pace      coming fast
 *   cramped   next to the back glass, or in a corner: no room to swing
 *   backpedal over the head of somebody going backwards
 *   risk      the other player aimed near the walls, and it came off
 *
 * With the hit zones on, where the ball is around the body too (see
 * src/sim/zones.ts):
 *
 *   body      at the chest, with no room to swing: a block
 *   behind    past the line of the body: a late slap
 *
 * It is a pure function of the contact, so the same number can be worked out
 * for a ball that has not arrived yet.
 */
export function ballPressure(ask: BallAsk, config: GameConfig, parts?: PressureParts): number {
  const { court, player: pc, shots } = config;
  const tune = shots.pressure;
  const weights = tune.weights;

  const netDistance = Math.abs(ask.ballY);
  const near = clamp((tune.belowFrom - netDistance) / (tune.belowFrom - tune.belowFull), 0, 1);
  const under = clamp((netHeightAt(court, ask.ballX) + tune.belowMargin - ask.ballZ) / tune.belowSpan, 0, 1);
  const floor = clamp((tune.floorFrom - ask.ballZ) / tune.floorSpan, 0, 1);
  const below = Math.max(near * under, floor);

  // A person's reach is generous, and so is what counts as getting there well.
  const comfortable = pc.sweetSpot + (ask.reach - pc.lungeExtra - pc.sweetSpot) * tune.comfort;
  const stretch = clamp((ask.gap - comfortable) / (ask.reach - comfortable), 0, 1);
  const pace = clamp((ask.speed - tune.paceFrom) / tune.paceSpan, 0, 1);

  const backGap = court.halfLength - netDistance;
  const sideGap = court.halfWidth - Math.abs(ask.ballX);
  const back = clamp((tune.crampedWithin - backGap) / tune.crampedWithin, 0, 1);
  const side = clamp((tune.crampedWithin - sideGap) / tune.crampedWithin, 0, 1);
  const cramped = back + tune.corner * side;

  const backpedal = backpedalOf(ask.retreat, ask.ballZ, config);
  // Where the ball is around the body counts only with the hit zones on: off, the sum is exactly what it always was.
  const zones = config.zones;
  const body = zones.on ? clamp(ask.body ?? 0, 0, 1) * zones.weights.body : 0;
  const behind = zones.on ? clamp(ask.behind ?? 0, 0, 1) * zones.weights.behind : 0;
  if (parts) {
    parts.below = below * weights.below;
    parts.stretch = stretch * weights.stretch;
    parts.pace = pace * weights.pace;
    parts.cramped = cramped * weights.cramped;
    parts.backpedal = backpedal * weights.backpedal;
    parts.risk = clamp(ask.risk, 0, 1) * weights.risk;
    parts.body = body;
    parts.behind = behind;
  }

  let sum =
    below * weights.below +
    stretch * weights.stretch +
    pace * weights.pace +
    cramped * weights.cramped +
    backpedal * weights.backpedal +
    clamp(ask.risk, 0, 1) * weights.risk;
  if (zones.on) sum += body + behind;
  return clamp(sum, 0, 1);
}
