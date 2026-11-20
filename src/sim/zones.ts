import type { GameConfig } from '../config';
import { clamp } from '../core/math';
import { teamDir } from './court';
import type { TeamId } from './types';

/**
 * Where the ball is met around the body (docs/zonas.md).
 *
 *   ideal   at the side, a little in front, near the sweet spot, between the
 *           knee and the shoulder: the shot comes out as it was asked for
 *   body    at the chest: there is no room to swing, only to block. It comes
 *           out soft, to the middle, and hard to direct
 *   far     at the edge of the reach: a stretch, and it comes out weak
 *   behind  it has gone past the line of the body: a late slap, weak and
 *           wild, or not reached at all
 *   high    over the head: an overhead, as always
 *   low     down at the floor: dug out, as always
 *
 * The zone is measured in the player's own axes. It faces the net and turns
 * toward the ball that is coming, by `zones.turn` at most, so the line of the
 * body is the one the ball has to cross to get past it. Every part is
 * gradual: a ball a little too close is a little cramped, never a miss.
 */
export type HitZone = 'ideal' | 'body' | 'far' | 'behind' | 'high' | 'low';

export const HIT_ZONES: readonly HitZone[] = ['ideal', 'body', 'far', 'behind', 'high', 'low'];

/** What a contact is like around the body. Every part is 0..1. */
export interface ZoneReading {
  zone: HitZone;
  /** How much the ball is at the body: no room for the arm. */
  body: number;
  /** How far past the line of the body it is. */
  behind: number;
  /** How stretched the contact is (the same measure as the pressure's `stretch`). */
  far: number;
  /** Metres from the body to the ball, across the body's own forward line, and along it (positive in front). */
  side: number;
  ahead: number;
}

export function createZoneReading(): ZoneReading {
  return { zone: 'ideal', body: 0, behind: 0, far: 0, side: 0, ahead: 0 };
}

/** A part this big (0..1) names the zone. */
const NAMES_IT = 0.5;
/** A ball lower than this is one dug out from the floor, higher than the overhead height one over the head. */
const LOW_ZONE = 0.4;

/** Which way a body faces, as a unit vector on the floor. */
export interface Facing {
  x: number;
  y: number;
}

/**
 * Which way a player of `team` faces to meet a ball moving at (`vx`, `vy`):
 * the net, turned toward where the ball comes from by `zones.turn` at most.
 * A ball coming from behind (off the back glass) is waited for facing the
 * net. One played into the own back glass (`facingBack`) is faced: the body
 * has turned round to the glass.
 */
export function zoneFacing(team: TeamId, vx: number, vy: number, config: GameConfig, out: Facing, facingBack = false): Facing {
  const dir = teamDir(team);
  out.x = 0;
  out.y = facingBack ? -dir : dir;
  // Where the ball comes from is (-vx, -vy). Only one coming from in front turns the body.
  const speed = Math.hypot(vx, vy);
  if (facingBack || -vy * dir <= 0 || speed === 0) return out;
  // Toward it, if that is within the turn; as far as the turn goes, otherwise. No angles: this runs
  // for every point of a trajectory when a contact is chosen.
  const towardX = -vx / speed;
  const towardY = -vy / speed;
  if (towardY * dir >= turnCos(config)) {
    out.x = towardX;
    out.y = towardY;
    return out;
  }
  const sin = turnSin(config) * Math.sign(towardX);
  out.x = sin;
  out.y = turnCos(config) * dir;
  return out;
}

/** The cosine and sine of the most the body turns (cached: the configuration does not change in a match). */
let cachedTurn = NaN;
let cachedCos = 1;
let cachedSin = 0;
function turnCos(config: GameConfig): number {
  if (config.zones.turn !== cachedTurn) cacheTurn(config.zones.turn);
  return cachedCos;
}
function turnSin(config: GameConfig): number {
  if (config.zones.turn !== cachedTurn) cacheTurn(config.zones.turn);
  return cachedSin;
}
function cacheTurn(turn: number): void {
  cachedTurn = turn;
  cachedCos = Math.cos((turn * Math.PI) / 180);
  cachedSin = Math.sin((turn * Math.PI) / 180);
}

const facing: Facing = { x: 0, y: 0 };

/**
 * Reads where a ball at (`ballX`, `ballY`, `ballZ`), moving at (`vx`, `vy`),
 * is around a player of `team` standing at (`x`, `y`). `reach` is how far
 * that player gets with a lunge at this height, for the stretch. A player
 * that plays the ball into its own back glass (`facingBack`) has turned
 * round to the glass: what is behind it is in front of it.
 */
export function readZone(
  team: TeamId,
  x: number,
  y: number,
  ballX: number,
  ballY: number,
  ballZ: number,
  vx: number,
  vy: number,
  reach: number,
  config: GameConfig,
  out: ZoneReading,
  facingBack = false,
): ZoneReading {
  const zones = config.zones;
  const pc = config.player;
  zoneFacing(team, vx, vy, config, facing, facingBack);
  const fx = facing.x;
  const fy = facing.y;
  const dx = ballX - x;
  const dy = ballY - y;
  const ahead = dx * fx + dy * fy;
  const side = Math.abs(dx * fy - dy * fx);
  const gap = Math.hypot(dx, dy);
  out.side = side;
  out.ahead = ahead;

  // At the body: close to its own forward line, not far in front, and below the head.
  const across = clamp((zones.bodyFree - side) / (zones.bodyFree - zones.bodyFull), 0, 1);
  const inFront = clamp((zones.bodyAheadFree - ahead) / (zones.bodyAheadFree - zones.bodyAhead), 0, 1);
  const below = clamp((pc.overheadZ - ballZ) / (pc.overheadZ - zones.bodyTop), 0, 1);
  out.body = across * inFront * below;

  // Past the line of the body. Over the head the back arches, and it can be met a little later.
  const from = ballZ >= pc.overheadZ ? zones.behindFromHigh : zones.behindFrom;
  out.behind = clamp((-ahead - from) / (zones.behindFull - from), 0, 1);

  // The stretch, measured as the pressure measures it.
  const comfortable = pc.sweetSpot + (reach - pc.lungeExtra - pc.sweetSpot) * config.shots.pressure.comfort;
  out.far = clamp((gap - comfortable) / Math.max(1e-6, reach - comfortable), 0, 1);

  const worst = Math.max(out.behind, out.body, out.far);
  if (worst >= NAMES_IT) out.zone = worst === out.behind ? 'behind' : worst === out.body ? 'body' : 'far';
  else if (ballZ < LOW_ZONE) out.zone = 'low';
  else if (ballZ >= pc.overheadZ) out.zone = 'high';
  else out.zone = 'ideal';
  return out;
}

/** True when a ball this far past the line of the body cannot be reached at all: the body does not get there. */
export function outOfZone(reading: ZoneReading, config: GameConfig): boolean {
  return -reading.ahead > config.zones.behindOut;
}
