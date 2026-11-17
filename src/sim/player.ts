import type { GameConfig } from '../config';
import { clamp } from '../core/math';
import { teamDir } from './court';
import type { InterceptPlan } from './intercept';
import type { PlayerIntent, ShotIntent, ShotKind, TeamId } from './types';

/** A swing that was requested and waits for the ball to arrive. */
export interface PendingSwing {
  intent: ShotIntent;
  requestedAt: number;
  /** Simulation time at which the racket meets the ball. */
  executeAt: number;
  /** Timing error in seconds: negative = early, positive = late. */
  error: number;
}

/** Abstract animation state. The renderer decides what it looks like. */
export interface PlayerAnim {
  kind: 'idle' | 'swing' | 'whiff' | 'serve';
  /** Simulation time the animation started at. */
  t0: number;
  duration: number;
  /** World-x side of the body the racket swings on. */
  side: 1 | -1;
  shot: ShotKind;
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
  /** 1 = right handed, -1 = left handed. */
  hand: 1 | -1;
}

export interface Player extends PlayerSetup {
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
  /** Where and when this player intends to meet the ball. */
  plan: InterceptPlan | null;
  swing: PendingSwing | null;
  swingLockUntil: number;
  anim: PlayerAnim;
  /** Resting position during the rally: the back of the court or the net. */
  homeMode: 'back' | 'net';
}

export function createPlayer(id: number, team: TeamId, index: number, setup: PlayerSetup): Player {
  return {
    ...setup,
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
    swing: null,
    swingLockUntil: 0,
    anim: { kind: 'idle', t0: 0, duration: 0, side: 1, shot: 'drive' },
    homeMode: 'back',
  };
}

/** Top speed of a player in metres per second. */
export function playerSpeed(player: Player, config: GameConfig): number {
  return config.player.maxSpeed * player.speedFactor;
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
