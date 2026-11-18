import { SIM_DT, type GameConfig } from '../config';
import { teamDir } from './court';
import { clampToHalf, playerReach, playerSpeed, travelTime, type Player } from './player';
import { isPastPlayer } from './shots';
import type { TrajPoint, Trajectory } from './trajectory';

/** Where and when a player intends to meet the ball. */
export interface InterceptPlan {
  trajId: number;
  /** Simulation time of the contact. */
  t: number;
  /** Position of the ball at contact. */
  x: number;
  y: number;
  z: number;
  /** Where the player has to stand for it. */
  stanceX: number;
  stanceY: number;
  /** In the air, after the bounce, or after the bounce and a wall. */
  kind: 'volley' | 'bounce' | 'wall';
  /** False when the player cannot get there in time and is only chasing. */
  reachable: boolean;
  /** Seconds to spare when the plan was made. */
  slack: number;
}

const stance = { x: 0, y: 0, gap: 0 };
const clamped = { x: 0, y: 0 };

/**
 * Best place to stand to hit the ball at `point`: the ball a comfortable
 * distance to one side and slightly in front. The side is the one that needs
 * less running, with a small preference for the forehand, and it flips by
 * itself when a wall leaves no room.
 */
function stanceFor(point: TrajPoint, player: Player, config: GameConfig): void {
  const pc = config.player;
  const dir = teamDir(player.team);
  const bodyY = point.y - dir * pc.contactAhead;
  const forehand = player.hand * dir;
  let bestCost = Infinity;
  for (let side = -1; side <= 1; side += 2) {
    clampToHalf(player.team, point.x - side * pc.sweetSpot, bodyY, config, clamped);
    const gap = Math.hypot(point.x - clamped.x, point.y - clamped.y);
    let cost = Math.hypot(clamped.x - player.x, clamped.y - player.y);
    if (side !== forehand) cost += 0.3;
    cost += Math.abs(gap - pc.sweetSpot) * 2;
    if (cost < bestCost) {
      bestCost = cost;
      stance.x = clamped.x;
      stance.y = clamped.y;
      stance.gap = gap;
    }
  }
}

/** How uncomfortable a contact is. Lower is better. */
function contactCost(
  point: TrajPoint,
  stanceY: number,
  slack: number,
  now: number,
  config: GameConfig,
): number {
  const pc = config.player;
  const court = config.court;
  let cost = 0;

  // Arriving with no time to set up.
  if (slack < 0.2) cost += (0.2 - slack) * 5;

  // Height: between the knees and the shoulders is the comfortable zone.
  if (point.z < 0.6) cost += (0.6 - point.z) * 3;
  else if (point.z > 1.4) cost += (point.z - 1.4) * (point.bounces === 0 ? 0.8 : 1.5);

  // A ball still shooting up right after the bounce is a half volley.
  if (point.vz > 2.5) cost += (point.vz - 2.5) * 0.3;

  // Slower balls are easier, which also favours waiting for the wall rebound.
  cost += Math.hypot(point.vx, point.vy) * 0.035;

  const netDistance = Math.abs(stanceY);
  if (point.z >= pc.overheadZ && netDistance <= pc.smashMaxNetDistance) {
    // A high ball this close to the net is there to be put away.
    cost -= 1.2;
  } else if (point.z >= pc.overheadZ && netDistance <= pc.overheadMaxNetDistance && point.bounces === 0) {
    // From mid court it is a bandeja: better than letting a lob push you back.
    cost -= 0.4;
  } else if (point.bounces === 0) {
    // Volleys belong to the net; from the back it is better to let it bounce.
    cost += netDistance < 4.5 ? -0.6 : netDistance < 6.5 ? 0.5 : 1.6;
  }

  // No room to swing next to a wall.
  const backGap = court.halfLength - Math.abs(point.y);
  if (backGap < 0.7) cost += (0.7 - backGap) * 2.5;
  const sideGap = court.halfWidth - Math.abs(point.x);
  if (sideGap < 0.45) cost += (0.45 - sideGap) * 2;

  // Waiting gives the opponent time to recover.
  cost += (point.t - now) * 0.25;
  return cost;
}

function kindOf(point: TrajPoint): InterceptPlan['kind'] {
  if (point.bounces === 0) return 'volley';
  return point.walls > 0 ? 'wall' : 'bounce';
}

/**
 * Chooses the contact for a player that is moved automatically (AI and
 * assisted movement). Every future point of the trajectory the player may
 * legally hit is scored; the most comfortable reachable one wins. That
 * includes points after the ball came off a wall.
 *
 * When nothing is reachable the plan is the contact the player misses by the
 * least, flagged as not reachable, so it still runs for the ball.
 */
export function planIntercept(
  trajectory: Trajectory,
  player: Player,
  now: number,
  config: GameConfig,
  minLead = 0,
): InterceptPlan | null {
  const pc = config.player;
  const speed = playerSpeed(player, config);
  const reach = playerReach(player, config);
  const points = trajectory.points;
  const first = Math.max(0, Math.ceil((now + minLead - trajectory.t0) / SIM_DT - 1e-6));

  let best: TrajPoint | null = null;
  let bestCost = Infinity;
  let bestX = 0;
  let bestY = 0;
  let bestSlack = 0;
  let chase: TrajPoint | null = null;
  let chaseSlack = -Infinity;
  let chaseX = 0;
  let chaseY = 0;

  for (let i = first; i < points.length; i += 2) {
    const point = points[i]!;
    if (point.hittable !== player.team) continue;
    if (point.z < pc.minContactZ || point.z > pc.maxContactZ) continue;
    stanceFor(point, player, config);
    if (stance.gap > reach) continue;

    const distance = Math.hypot(stance.x - player.x, stance.y - player.y);
    const slack = point.t - now - travelTime(distance, speed, pc.accel);
    if (slack < -0.03) {
      if (slack > chaseSlack) {
        chase = point;
        chaseSlack = slack;
        chaseX = stance.x;
        chaseY = stance.y;
      }
      continue;
    }
    let cost = contactCost(point, stance.y, slack, now, config);
    // Some players like the glass and wait for it; others would rather not.
    if (point.walls > 0) cost -= player.wallBias;
    if (cost < bestCost) {
      best = point;
      bestCost = cost;
      bestX = stance.x;
      bestY = stance.y;
      bestSlack = slack;
    }
  }

  if (best) {
    return {
      trajId: trajectory.id,
      t: best.t,
      x: best.x,
      y: best.y,
      z: best.z,
      stanceX: bestX,
      stanceY: bestY,
      kind: kindOf(best),
      reachable: true,
      slack: bestSlack,
    };
  }
  if (chase) {
    return {
      trajId: trajectory.id,
      t: chase.t,
      x: chase.x,
      y: chase.y,
      z: chase.z,
      stanceX: chaseX,
      stanceY: chaseY,
      kind: kindOf(chase),
      reachable: false,
      slack: chaseSlack,
    };
  }
  return null;
}

/** What a metre away from the comfortable spot weighs against the comfort of the ball itself. */
const PLACEMENT_WEIGHT = 1.5;
/** What a ball that can only be played into the own glass costs against any other. */
const LAST_RESORT = 6;

/**
 * The best ball for a player who stays where it is standing right now: within
 * reach, close to where a ball is comfortable to hit (to one side and slightly
 * in front), and a comfortable ball in itself, judged the way a player that
 * runs by itself judges it. So from the back of the court it waits for the
 * bounce, and for the rebound off the glass when that is the easier ball. It
 * looks `ahead` seconds forward and `back` seconds behind; a contact slightly
 * in the past is what makes a swing late.
 *
 * A ball that got past the player next to its own glass counts only when the
 * window holds nothing else, and not at all with `allowPast` off.
 *
 * This is the contact of a player that moves by hand, and also how an
 * assisted player takes a ball that is passing by instead of waiting for it.
 */
export function contactNear(
  trajectory: Trajectory,
  player: Player,
  now: number,
  config: GameConfig,
  ahead = config.timing.manualLookahead,
  back = config.timing.lateMax,
  out?: InterceptPlan,
  allowPast = true,
): InterceptPlan | null {
  const pc = config.player;
  const reach = playerReach(player, config);
  const points = trajectory.points;
  const from = Math.max(0, Math.floor((now - back - trajectory.t0) / SIM_DT));
  const to = Math.min(points.length - 1, Math.ceil((now + ahead - trajectory.t0) / SIM_DT));
  const frontY = player.y + teamDir(player.team) * pc.contactAhead;

  let best: TrajPoint | null = null;
  let bestScore = Infinity;
  for (let i = from; i <= to; i++) {
    const point = points[i]!;
    if (point.hittable !== player.team) continue;
    if (point.z < pc.minContactZ || point.z > pc.maxContactZ) continue;
    const dx = point.x - player.x;
    if (Math.hypot(dx, point.y - player.y) > reach) continue;
    // Distance to the nearer of the two comfortable spots, one on each side of the body.
    let score = Math.hypot(Math.abs(dx) - pc.sweetSpot, point.y - frontY) * PLACEMENT_WEIGHT;
    // Nobody has to run, so there is no hurry to count: only the ball itself.
    score += contactCost(point, player.y, 1, now, config);
    if (isPastPlayer(player.team, player.y, point.y, point.bounces, config)) {
      if (!allowPast) continue;
      score += LAST_RESORT;
    }
    if (score < bestScore) {
      best = point;
      bestScore = score;
    }
  }
  if (!best) return null;
  // This runs every step for a player moved by hand: write into `out` when given.
  const plan = out ?? ({} as InterceptPlan);
  plan.trajId = trajectory.id;
  plan.t = best.t;
  plan.x = best.x;
  plan.y = best.y;
  plan.z = best.z;
  plan.stanceX = player.x;
  plan.stanceY = player.y;
  plan.kind = kindOf(best);
  plan.reachable = true;
  plan.slack = best.t - now;
  return plan;
}
