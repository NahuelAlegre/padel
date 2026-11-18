import type { CourtConfig, GameConfig, PhysicsConfig, TimingConfig } from '../config';
import { clamp, lerp } from '../core/math';
import { netHeightAt, teamDir } from './court';
import type { Quality, ShotIntent, ShotKind, TeamId } from './types';

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  /** Flight time until the ball lands on the target. */
  time: number;
}

export interface ShotParams {
  /** Minimum height above the net tape. */
  clearance: number;
  /** Peak height of the arc, 0 = as flat as `speed` allows. */
  apex: number;
  /** Top horizontal speed. */
  speed: number;
}

/** No shot hangs in the air longer than this, however much clearance it would need. */
const MAX_FLIGHT_TIME = 2.6;
/** The most pace a player can put on a shot, against the usual pace of that shot. */
const MAX_POWER = 1.2;
const MAX_SMASH_POWER = 1.05;
/** The slowest a ball can be sent into the own glass and still come back off it. */
const MIN_BACK_WALL_SPEED = 9;

/**
 * Launch velocity that takes the ball from (x0, y0, z0) to the floor at
 * (targetX, targetY).
 *
 * Without drag the flight is a parabola, so one number is left to choose: the
 * flight time. A lob fixes it through the height of the arc; every other shot
 * goes as fast as `speed` allows, and slows down (which also raises the arc)
 * just enough to clear the net by `clearance`.
 */
export function solveShot(
  x0: number,
  y0: number,
  z0: number,
  targetX: number,
  targetY: number,
  params: ShotParams,
  physics: PhysicsConfig,
  court: CourtConfig,
): Launch {
  const g = physics.gravity;
  const z1 = physics.ballRadius;
  const dx = targetX - x0;
  const dy = targetY - y0;
  const distance = Math.hypot(dx, dy);

  let time: number;
  if (params.apex > 0) {
    const apex = Math.max(params.apex, z0 + 0.3);
    const up = Math.sqrt(2 * g * (apex - z0));
    time = (up + Math.sqrt(up * up + 2 * g * (z0 - z1))) / g;
  } else {
    time = distance / Math.max(params.speed, 0.1);
  }

  // Height needed where the path crosses the net plane.
  if (y0 * targetY < 0 && dy !== 0) {
    const s = -y0 / dy;
    const crossX = x0 + dx * s;
    const needed = netHeightAt(court, crossX) + params.clearance + physics.ballRadius;
    const straight = z0 * (1 - s) + z1 * s;
    if (needed > straight) {
      // A ball dug out right next to the net would need an absurd arc to clear
      // it: cap the flight time and let it die in the net instead.
      const minTime = Math.min(MAX_FLIGHT_TIME, Math.sqrt((2 * (needed - straight)) / (g * s * (1 - s))));
      if (minTime > time) time = minTime;
    }
  }

  time = Math.max(time, 0.05);
  return {
    vx: dx / time,
    vy: dy / time,
    vz: (z1 - z0) / time + 0.5 * g * time,
    time,
  };
}

/**
 * Contrapared: the ball got past the player, so it is hit into the player's
 * own back glass to come off it and over the net.
 *
 * The glass keeps the vertical speed, so seen from the side the whole trip is
 * still one parabola; only the horizontal speed changes at the wall. The ball
 * is sent into the glass at `speed`, and slower (which hangs longer and flies
 * higher) if that would not clear the net by `clearance`.
 */
export function solveBackWall(
  x0: number,
  y0: number,
  z0: number,
  targetX: number,
  targetY: number,
  team: TeamId,
  params: ShotParams,
  physics: PhysicsConfig,
  court: CourtConfig,
): Launch {
  const g = physics.gravity;
  const z1 = physics.ballRadius;
  const dir = teamDir(team);
  const wallY = -dir * (court.halfLength - physics.ballRadius);
  const toWall = Math.max(0.05, Math.abs(y0 - wallY));
  const fromWall = Math.abs(targetY - wallY);
  const toNet = Math.abs(wallY);
  const needed = netHeightAt(court, targetX * 0.5) + params.clearance + physics.ballRadius;

  let best: Launch | null = null;
  // A weak one is still hit hard enough to come back off the glass.
  for (let speed = Math.max(params.speed, MIN_BACK_WALL_SPEED); speed >= MIN_BACK_WALL_SPEED; speed -= 1) {
    const out = speed * physics.glassRestitution;
    const t1 = toWall / speed;
    const t2 = fromWall / out;
    const time = t1 + t2;
    const vz = (z1 - z0) / time + 0.5 * g * time;
    const launch: Launch = {
      vx: (targetX - x0) / (t1 + physics.glassGrip * t2),
      vy: -dir * speed,
      vz,
      time,
    };
    best = launch;
    const atWall = z0 + vz * t1 - 0.5 * g * t1 * t1;
    const tNet = t1 + toNet / out;
    const atNet = z0 + vz * tNet - 0.5 * g * tNet * tNet;
    if (atNet >= needed && atWall < court.backGlass - 0.2 && atWall > z1) break;
  }
  return best!;
}

/** Where the ball and the player are when the racket meets it. */
export interface ShotContext {
  team: TeamId;
  /** 1 = right handed, -1 = left handed. */
  hand: 1 | -1;
  playerX: number;
  playerY: number;
  ballX: number;
  ballY: number;
  ballZ: number;
  /** Bounces on this player's half since the opponent hit (0 = taken in the air). */
  bounces: number;
  /** Walls touched after that bounce. */
  walls: number;
  /** 0..1, how hard the ball is to play (see `ballPressure`). Left out, it is a comfortable one. */
  pressure?: number;
  /** 0..1, how much the player is going backwards under a high ball. Left out, not at all. */
  backpedal?: number;
}

/**
 * True when the ball has got past the player next to the player's own back
 * glass. From there it cannot be played forward: the only shot left is into
 * the glass (contrapared), so it is a ball to take only when there is no other.
 */
export function isPastPlayer(
  team: TeamId,
  playerY: number,
  ballY: number,
  bounces: number,
  config: GameConfig,
): boolean {
  const pc = config.player;
  const behind = (playerY - ballY) * teamDir(team);
  const wallDistance = config.court.halfLength - Math.abs(ballY);
  return bounces >= 1 && behind >= pc.backWallBehind && wallDistance <= pc.backWallZone;
}

/** The shot that comes out of an intent in a given situation. */
export interface ResolvedShot {
  kind: ShotKind;
  /** Played on the side of the racket hand. */
  forehand: boolean;
  /** Where it is meant to land, in world space. */
  targetX: number;
  targetY: number;
  params: ShotParams;
  /** 0..1: how close to the walls it is aimed. The risk the player chose. */
  risk: number;
  /** For a lob, 0..1: how good it came out. 1 lands next to the glass, 0 where it can be smashed. */
  lobQuality: number;
  /** The spin it leaves with: what its first bounce keeps of its vertical and horizontal speed, or 0 for an ordinary bounce. */
  kick: number;
  grip: number;
}

/** Which shot an intent turns into in a given situation. See `resolveShot`. */
export function shotKind(ctx: ShotContext, intent: ShotIntent, config: GameConfig): ShotKind {
  const { player: pc, shots } = config;
  const netDistance = Math.abs(ctx.ballY);
  if (isPastPlayer(ctx.team, ctx.playerY, ctx.ballY, ctx.bounces, config)) return 'backWall';
  if (intent.lob) return 'lob';
  if (clamp(intent.depth, 0, 1) <= shots.dropAt) return 'drop';
  // A smash needs the feet under the ball: going backwards it is a bandeja.
  const settled = (ctx.backpedal ?? 0) <= shots.pressure.forcedBandeja;
  if (ctx.ballZ >= pc.smashZ && netDistance <= pc.smashMaxNetDistance && settled) return 'smash';
  if (ctx.ballZ >= pc.overheadZ && netDistance <= pc.overheadMaxNetDistance) {
    return Math.abs(clamp(intent.aim, -1, 1)) >= shots.viboraAim ? 'vibora' : 'bandeja';
  }
  if (ctx.bounces === 0 && netDistance <= pc.volleyMaxNetDistance) return 'volley';
  if (ctx.bounces >= 1 && ctx.walls >= 1) return 'wallExit';
  return 'drive';
}

/**
 * Decides which shot comes out and where it goes.
 *
 * The player only says where it wants the ball (side, depth, over or
 * through). The situation names the shot:
 *
 *   the ball got past, close to the own back glass  contrapared
 *   asked over the opponent                          globo
 *   asked short                                      chiquita / dejada
 *   high ball, close to the net                      remate
 *   high ball, mid court                             bandeja, or víbora when aimed wide
 *   in the air, near the net                         volea
 *   after a wall                                     salida de pared
 *   anything else                                    derecha / revés
 *
 * And how well it comes out, which is not chosen but earned:
 *
 *   the timing     a late swing is weak, short and floats; a perfect one adds
 *                  to each shot what that shot is for (`shots.perfect`)
 *   the ball       a difficult one (`pressure`) comes back slower, higher
 *                  and with less angle
 *   a lob          its depth is its quality: timing and pressure decide
 *                  whether it lands next to the glass or where it gets smashed
 *
 * It is a pure function, so the aim marker shows exactly what will happen.
 * `quality` is the timing of the swing; before the swing, a good one stands in.
 */
export function resolveShot(
  ctx: ShotContext,
  intent: ShotIntent,
  config: GameConfig,
  quality: Quality = 'good',
): ResolvedShot {
  const { shots, court } = config;
  const dir = teamDir(ctx.team);
  const aim = clamp(intent.aim, -1, 1);
  const depth = clamp(intent.depth, 0, 1);
  const kind = shotKind(ctx, intent, config);

  const spec = shots.specs[kind];
  const effect = shots.quality[quality];
  const perfect = quality === 'perfect' ? shots.perfect[kind] : undefined;
  const squeeze = shots.pressure;
  const pressure = clamp(ctx.pressure ?? 0, 0, 1);

  let targetDepth: number;
  let apex = spec.apex;
  let lobQuality = 0;
  if (kind === 'lob') {
    lobQuality = shots.lobQuality[quality] * (1 - squeeze.lobCut * pressure);
    targetDepth = lerp(spec.depthNear, spec.depthFar, lobQuality);
    apex += shots.lobApexGain * (lobQuality - shots.lobQuality.good);
  } else {
    const deep = clamp((depth - shots.dropAt) / (1 - shots.dropAt), 0, 1);
    targetDepth = lerp(spec.depthNear, spec.depthFar, deep) + (perfect?.depth ?? 0);
    // A weak ball lands short: a late one, and one that was hard to play.
    targetDepth = lerp(targetDepth, shots.shortDepth, effect.shorten);
    if (kind !== 'drop') targetDepth = lerp(targetDepth, shots.shortDepth, squeeze.shortenAdd * pressure);
  }
  const targetX = aim * spec.aimRange * (1 - squeeze.aimCut * pressure) * (perfect?.aim ?? 1);
  // A hard hitter gets a little more out of every shot, but not out of a
  // smash: that one is already as fast as the game can take.
  const power = clamp(intent.power, 0.3, kind === 'smash' ? MAX_SMASH_POWER : MAX_POWER);
  const speed = spec.speed * power * effect.pace * (perfect?.pace ?? 1) * (1 - squeeze.paceCut * pressure);
  const clearance = Math.max(
    shots.minClearance,
    spec.clearance + effect.lift + (perfect?.clearance ?? 0) + squeeze.liftAdd * pressure,
  );

  // The spin of the shot. Under pressure it is the first thing to go: a
  // forced smash bounces like any other ball.
  const spin = shots.spin[kind];
  const kick = perfect?.kick ?? spin?.kick ?? 0;
  const grip = perfect?.grip ?? spin?.grip ?? 0;

  // Risk: how little room is left to the side wall and, for flat shots, to the back wall.
  const sideRoom = court.halfWidth - Math.abs(targetX);
  const backRoom = court.halfLength - targetDepth;
  let risk = clamp(1 - sideRoom / 2.4, 0, 1);
  if (spec.apex === 0) risk += clamp(1 - backRoom / 2.2, 0, 1) * 0.6;

  return {
    kind,
    forehand: (ctx.ballX - ctx.playerX) * dir * ctx.hand >= 0,
    targetX,
    targetY: dir * targetDepth,
    params: { clearance, apex, speed },
    risk: clamp(risk, 0, 1),
    lobQuality,
    kick: kick > 0 ? lerp(kick, config.physics.floorRestitution, pressure) : 0,
    grip: grip > 0 ? lerp(grip, config.physics.floorGrip, pressure) : 0,
  };
}

/** Where a serve aimed with `intent` is meant to land. `box` is the sign of x of the service box. */
export function serveTarget(
  team: TeamId,
  box: 1 | -1,
  intent: ShotIntent,
  config: GameConfig,
): { x: number; y: number } {
  const spec = config.shots.specs.serve;
  return {
    x: box * (config.court.halfWidth / 2) + clamp(intent.aim, -1, 1) * spec.aimRange,
    y: teamDir(team) * spec.depthNear,
  };
}

/**
 * Timing error in seconds (negative = the swing came before the ball) to the
 * quality shown to the player.
 *
 * A swing that comes early is armed and waits for the ball, so "early" only
 * tells the player why it was not a perfect: it plays like a good one (see
 * `shots.quality`). Being late is what costs.
 */
export function qualityFromError(error: number, timing: TimingConfig): Quality {
  const magnitude = Math.abs(error);
  if (magnitude <= timing.perfect) return 'perfect';
  if (magnitude <= timing.good) return 'good';
  return error < 0 ? 'early' : 'late';
}
