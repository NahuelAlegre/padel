import type { GameConfig } from '../config';
import { clamp } from '../core/math';
import { teamDir } from './court';
import type { InterceptPlan } from './intercept';
import { startingLane, type CallKind } from './pair';
import type { PlayerIntent, ShotIntent, ShotKind, TeamId } from './types';

/**
 * A swing that was asked for and is armed: the racket is back and the ball is
 * struck the moment it gets to the player. Asking early is how a player
 * chooses where to hit before the ball arrives.
 */
export interface PendingSwing {
  intent: ShotIntent;
  /** Simulation time of the request, already corrected for input latency. */
  at: number;
}

/** Abstract animation state. The renderer decides what it looks like. */
export interface PlayerAnim {
  kind: 'idle' | 'swing' | 'whiff' | 'serve';
  /** Simulation time the animation started at. */
  t0: number;
  duration: number;
  /**
   * Simulation time at which the racket meets the ball, as far as it is known:
   * Infinity while the player is armed with no ball within reach.
   */
  contactAt: number;
  /** World-x side of the body the racket swings on. */
  side: 1 | -1;
  shot: ShotKind;
  /**
   * Where the ball is met, relative to the player's feet (world metres). The
   * reach is generous, so the figure has to stretch for the ball to look hit.
   */
  reachX: number;
  reachY: number;
  reachZ: number;
}

export interface PlayerSetup {
  name: string;
  isHuman: boolean;
  /** Moved directly by its controller instead of by the assisted movement. */
  manual: boolean;
  speedFactor: number;
  /** Delay before the player reads a new ball. */
  reaction: number;
  /** Multiplier on the scatter of its shots (1 = standard). */
  errorScale: number;
  /** Multiplier on the reach. A person gets a generous one: getting close is enough. */
  reachScale: number;
  /** 1 = right handed, -1 = left handed. */
  hand: 1 | -1;
  /**
   * Taste for the ball that comes back off a wall, when the player chooses its
   * own contact: above 0 it would rather wait for the rebound, below 0 it
   * takes the ball before the glass when it can. Left out, it is 0.
   */
  wallBias?: number;
  /**
   * 0..1, how much it would rather take a lob in the air than give up the
   * net, when it chooses its own contact. Left out, it is 0.
   */
  holdNet?: number;
  /** 0..1, how little a run of difficult balls gets to it. Left out, it is 0.5. */
  composure?: number;
}

export interface Player extends PlayerSetup {
  wallBias: number;
  holdNet: number;
  composure: number;
  /**
   * What the rally has done to it so far: it grows with every difficult ball
   * it has to play and fades with the comfortable ones. Zero at every serve.
   */
  strain: number;
  /** 0..1, how hard the last ball it played was. For whoever wants to show it. */
  pressure: number;
  id: number;
  team: TeamId;
  /** Position inside the team: 0 plays the right side, 1 the left. */
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the previous step, for render interpolation. */
  px: number;
  py: number;
  /** Where to stand while the ball is not in play. */
  spotX: number;
  spotY: number;
  /** Where and when this player can meet the ball. */
  plan: InterceptPlan | null;
  /**
   * For a player moved by hand: where it would be best to stand. Advice for
   * the visual aids only; nothing in the simulation acts on it.
   */
  guide: InterceptPlan | null;
  /** Reused every step for the contact of a hand-moved player. */
  contact: InterceptPlan;
  swing: PendingSwing | null;
  swingLockUntil: number;
  /** The shot it has decided to play and is winding up for, and since when. */
  cue: ShotIntent | null;
  cueAt: number;
  anim: PlayerAnim;
  /** Resting position during the rally: the back of the court or the net. */
  homeMode: 'back' | 'net';
  /** Doubles: the side of the pair it plays on, as the sign of world x. */
  lane: 1 | -1;
  /** Doubles: what it last told its partner, and when. Only for show: it is always true. */
  call: CallKind | null;
  callAt: number;
  /** The ball that call was about, so each ball gets one at most. */
  callTraj: number;
}

export function createPlayer(id: number, team: TeamId, index: number, setup: PlayerSetup): Player {
  return {
    ...setup,
    wallBias: setup.wallBias ?? 0,
    holdNet: setup.holdNet ?? 0,
    composure: setup.composure ?? 0.5,
    strain: 0,
    pressure: 0,
    id,
    team,
    index,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    px: 0,
    py: 0,
    spotX: 0,
    spotY: 0,
    plan: null,
    guide: null,
    contact: { trajId: 0, t: 0, x: 0, y: 0, z: 0, stanceX: 0, stanceY: 0, kind: 'bounce', reachable: true, slack: 0 },
    swing: null,
    swingLockUntil: 0,
    cue: null,
    cueAt: 0,
    anim: { kind: 'idle', t0: 0, duration: 0, contactAt: Infinity, side: 1, shot: 'drive', reachX: 0.6, reachY: 0.2, reachZ: 0.9 },
    homeMode: 'back',
    lane: startingLane(team, index),
    call: null,
    callAt: 0,
    callTraj: -1,
  };
}

/** Top speed of a player in metres per second. */
export function playerSpeed(player: Player, config: GameConfig): number {
  return config.player.maxSpeed * player.speedFactor;
}

/**
 * Horizontal distance from the body at which this player can hit the ball
 * standing, without a lunge. With the real reach it is the same for
 * everybody, and it shrinks over the head (pass the height of the ball).
 */
export function playerReach(player: Player, config: GameConfig, z = 1): number {
  const pc = config.player;
  if (!pc.realReach) return pc.reach * player.reachScale;
  const real = pc.real;
  if (z <= real.highFrom) return real.reach;
  const k = clamp((z - real.highFrom) / (pc.maxContactZ - real.highFrom), 0, 1);
  return real.reach + (real.highReach - real.reach) * k;
}

/** How much further than `playerReach` a lunge gets, with the real reach. */
export function lungeReach(config: GameConfig): number {
  return config.player.realReach ? config.player.real.lunge : config.player.lungeExtra;
}

/** The lowest ball that can still be played, standing or lunging. */
export function lowestContact(config: GameConfig, lunging: boolean): number {
  const pc = config.player;
  if (!pc.realReach) return pc.minContactZ;
  return lunging ? pc.real.lungeFloorZ : Math.max(pc.minContactZ, pc.real.floorZ);
}

/**
 * Time needed to run `distance` metres from a standing start and stop there:
 * accelerate, cruise, brake.
 */
export function travelTime(distance: number, speed: number, accel: number): number {
  if (distance <= 0.03) return 0;
  const rampDistance = (speed * speed) / accel;
  if (distance < rampDistance) return 2 * Math.sqrt(distance / accel);
  return distance / speed + speed / accel;
}

/** Keeps a position inside the half of the court a team may walk on. */
export function clampToHalf(
  team: TeamId,
  x: number,
  y: number,
  config: GameConfig,
  out: { x: number; y: number },
): void {
  const maxX = config.court.halfWidth - config.player.radius;
  const far = config.court.halfLength - config.player.radius;
  const near = config.player.netGap;
  out.x = clamp(x, -maxX, maxX);
  out.y = teamDir(team) > 0 ? clamp(y, -far, -near) : clamp(y, near, far);
}

const clamped = { x: 0, y: 0 };

/** Moves a player for one step according to its intent. */
export function movePlayer(player: Player, intent: PlayerIntent, dt: number, config: GameConfig): void {
  const pc = config.player;
  const top = playerSpeed(player, config);

  let wantX = 0;
  let wantY = 0;
  if (intent.hasTarget) {
    const dx = intent.targetX - player.x;
    const dy = intent.targetY - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.02) {
      // Brake on arrival so the player stops on the spot instead of overshooting.
      const speed = Math.min(top, Math.sqrt(2 * pc.accel * distance));
      wantX = (dx / distance) * speed;
      wantY = (dy / distance) * speed;
    }
  } else {
    const magnitude = Math.hypot(intent.moveX, intent.moveY);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    wantX = intent.moveX * scale * top;
    wantY = intent.moveY * scale * top;
  }

  const dvx = wantX - player.vx;
  const dvy = wantY - player.vy;
  const dv = Math.hypot(dvx, dvy);
  const maxDv = pc.accel * dt;
  if (dv <= maxDv) {
    player.vx = wantX;
    player.vy = wantY;
  } else {
    player.vx += (dvx / dv) * maxDv;
    player.vy += (dvy / dv) * maxDv;
  }

  const nextX = player.x + player.vx * dt;
  const nextY = player.y + player.vy * dt;
  clampToHalf(player.team, nextX, nextY, config, clamped);
  if (clamped.x !== nextX) player.vx = 0;
  if (clamped.y !== nextY) player.vy = 0;
  player.x = clamped.x;
  player.y = clamped.y;
}
