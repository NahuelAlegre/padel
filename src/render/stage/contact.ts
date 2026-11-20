import { smoothstep } from '../../core/math';
import type { BallFrame, EffectFrame, FigureFrame } from './frame';

/**
 * The ball on the racket, only in what is drawn.
 *
 * The simulation meets the ball where it decides, and the body gets the
 * racket there as a body can: a little short, sometimes, rather than an arm
 * thrown at it. So for a few frames around the contact the ball that is drawn
 * leaves its real path, comes onto the face of the racket that hits it, and
 * goes back to its path as it leaves: it is seen to come off the racket. Its
 * shadow goes with it. The simulation never knows.
 */

/**
 * Seconds before the contact the drawn ball starts coming to the racket,
 * seconds after it that it is back on its path, and how long it is right on
 * the racket, either side of the contact: at least the frame of the contact,
 * at sixty frames a second.
 */
export const BALL_ON_RACKET = { before: 0.075, after: 0.11, hold: 0.009 };
/**
 * Seconds before the contact from which the ball goes for where the racket
 * really is going to be, its hand a little behind if the clip turns it over
 * faster than a wrist does (see `FigureAnimator.racketAtContact`); before
 * that, for where the stroke plans to meet it, which hardly moves.
 */
const LOCK = 0.035;

/** How much of the way to the racket the drawn ball is `eta` seconds before the contact (negative after it). */
export function racketPull(eta: number): number {
  const { before, after, hold } = BALL_ON_RACKET;
  if (eta >= 0) return eta <= hold ? 1 : 1 - smoothstep(hold, before, eta);
  return -eta <= hold ? 1 : 1 - smoothstep(hold, after, -eta);
}

/** The radius of a padel ball, in metres: what the middle of the ball is off the face it rests on. */
const BALL = 0.033;

/** The head of a racket as it is drawn, on the court. */
export interface RacketFace {
  /** Its middle. */
  x: number;
  y: number;
  z: number;
  /** Which way one of its two faces looks, of length one. */
  nx: number;
  ny: number;
  nz: number;
  /** How far from the middle a ball can be drawn on it, and half its thickness, in metres on the court. */
  reach: number;
  half: number;
}

/**
 * Where a ball that is at (bx, by, bz) is drawn on a face of a racket: the
 * point of the face nearest to it, not too far from the middle, with the ball
 * resting on the face it is hit with. `side` says which of the two faces
 * that is (1 the one `face` looks out of, -1 the other).
 *
 * It rests there as a real ball does, its middle a ball's radius off the
 * face: the one drawn is bigger, so seen from any side it overlaps the head
 * of the racket and reads as on it, even with the head edge on to the camera.
 */
export function onFace(face: RacketFace, bx: number, by: number, bz: number, side: number, out: number[]): number[] {
  const dx = bx - face.x;
  const dy = by - face.y;
  const dz = bz - face.z;
  const along = dx * face.nx + dy * face.ny + dz * face.nz;
  let px = dx - face.nx * along;
  let py = dy - face.ny * along;
  let pz = dz - face.nz * along;
  const off = Math.sqrt(px * px + py * py + pz * pz);
  if (off > face.reach) {
    const k = face.reach / off;
    px *= k;
    py *= k;
    pz *= k;
  }
  const lift = side * (face.half + BALL);
  out[0] = face.x + px + face.nx * lift;
  out[1] = face.y + py + face.ny * lift;
  out[2] = face.z + pz + face.nz * lift;
  return out;
}

/**
 * Which face of the racket a ball is hit with: the one it comes toward. From
 * how it moves (`vx`, `vy`, `vz`), and if it moves along the face, from where
 * it is (`dx`, `dy`, `dz` from the middle of the head).
 */
export function faceSide(face: RacketFace, vx: number, vy: number, vz: number, dx: number, dy: number, dz: number): number {
  const toward = vx * face.nx + vy * face.ny + vz * face.nz;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (Math.abs(toward) > 0.2 * speed) return toward < 0 ? 1 : -1;
  return dx * face.nx + dy * face.ny + dz * face.nz >= 0 ? 1 : -1;
}

/**
 * The ball on the racket, frame after frame. It is told of every hit of the
 * simulation (`hit`), and for every frame it moves the ball that is drawn,
 * its trail and the sparkle of the hit (`place`).
 *
 * Before the contact the ball bends toward where the racket is going to meet
 * it, not toward where the racket still is, far back in its swing; after it,
 * only if that one really did hit it, it leaves from where they met, along
 * its own way, not with the follow-through.
 */
export class BallOnRacket {
  /** Who has really hit the ball in the stroke on show. */
  private readonly struck: boolean[] = [];
  /**
   * Who the ball is drawn coming to or off, and on which face of the racket;
   * where the racket was going to meet it in the last frame before the
   * contact; how far that is from where the simulation meets it, kept from
   * the contact on; and whether the contact is past.
   */
  private readonly pull = { player: -1, side: 1, eta: Number.NaN, tx: 0, ty: 0, tz: 0, left: false, ox: 0, oy: 0, oz: 0 };
  /** The sparkle of the last hit: who hit it and where the simulation did, and how far from there it is drawn. */
  private readonly spark = { player: -1, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, placed: false };
  private readonly face: RacketFace = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, reach: 0, half: 0 };
  private readonly at = [0, 0, 0];

  /** The simulation hit the ball: player `player`, at (x, y, z). */
  hit(player: number, x: number, y: number, z: number): void {
    this.struck[player] = true;
    const spark = this.spark;
    spark.player = player;
    spark.x = x;
    spark.y = y;
    spark.z = z;
    spark.dx = 0;
    spark.dy = 0;
    spark.dz = 0;
    spark.placed = false;
  }

  reset(): void {
    this.struck.length = 0;
    this.pull.player = -1;
    this.spark.player = -1;
  }

  /**
   * Moves the ball drawn in this frame. `faceOf` puts the head of the racket
   * of figure `i`, posed for this frame, into `out` (false if it has none),
   * and `plannedOf` where the middle of it is going to meet the ball, counting
   * `behind` of how far its hand is behind (false if that is not known);
   * `velocity` is how the ball really moves; `effects` the effects drawn in
   * this frame.
   */
  place(
    figures: readonly FigureFrame[],
    faceOf: (figure: number, out: RacketFace) => boolean,
    plannedOf: (figure: number, out: number[], behind: number) => boolean,
    ball: BallFrame,
    velocity: { vx: number; vy: number; vz: number },
    effects: EffectFrame[],
  ): void {
    let who = -1;
    let eta = Infinity;
    for (let i = 0; i < figures.length; i++) {
      const player = figures[i]!.player;
      // A hit counts for the stroke it was made in: a new one, or none, starts afresh.
      if (player.anim === 'idle' || player.contactIn > 0.03) this.struck[i] = false;
      if (player.anim !== 'swing' && player.anim !== 'serve') continue;
      const e = player.contactIn;
      if (!(e < BALL_ON_RACKET.before && e > -BALL_ON_RACKET.after)) continue;
      if (e <= 0 && !this.struck[i]) continue;
      if (Math.abs(e) < Math.abs(eta)) {
        eta = e;
        who = i;
      }
    }
    const face = this.face;
    const pull = this.pull;
    const spark = this.spark;
    if (who < 0 || !ball.visible || !faceOf(who, face)) {
      pull.player = -1;
    } else {
      // The face it is hit with is the one it comes toward: worked out once, as it starts coming, and kept.
      if (pull.player !== who) {
        const way = eta > 0 ? 1 : -1;
        pull.side = faceSide(face, velocity.vx * way, velocity.vy * way, velocity.vz * way, ball.x - face.x, ball.y - face.y, ball.z - face.z);
        pull.player = who;
        pull.eta = Number.NaN;
        pull.left = false;
      }
      // Where the simulation meets the ball. A serve is shown as big as the server, hand and ball (see the director).
      const hitter = figures[who]!;
      const own = hitter.player.anim === 'serve' ? hitter.k : 1;
      const bx = hitter.player.x + hitter.player.reachX * own;
      const by = hitter.player.y + hitter.player.reachY * own;
      const bz = hitter.player.reachZ * own;
      // Where it is going to rest on the racket instead: on the face it is hit with, where the racket is going to
      // meet it; or, not knowing that, the point of the face nearest to it.
      const at = this.at;
      if (plannedOf(who, at, eta > 0 ? 1 - smoothstep(0, LOCK, eta) : 1)) {
        const lift = pull.side * (face.half + BALL);
        at[0] = at[0]! + face.nx * lift;
        at[1] = at[1]! + face.ny * lift;
        at[2] = at[2]! + face.nz * lift;
      } else {
        onFace(face, bx, by, bz, pull.side, at);
      }
      at[2] = Math.max(0.033, at[2]!);
      // The ball is drawn off its own path by as much as the racket is from where the simulation meets it: more as
      // the contact comes, less as it leaves. Up to the contact the racket is where it is going to be; from it on,
      // where it was right at the contact.
      let cx = at[0]!;
      let cy = at[1]!;
      let cz = at[2]!;
      if (eta > 0) {
        pull.eta = eta;
        pull.tx = cx;
        pull.ty = cy;
        pull.tz = cz;
        pull.ox = cx - bx;
        pull.oy = cy - by;
        pull.oz = cz - bz;
      } else if (!pull.left) {
        // Right at the contact: between the last frame before it and this one.
        if (pull.eta > 0) {
          const u = pull.eta / (pull.eta - eta);
          cx = pull.tx + (cx - pull.tx) * u;
          cy = pull.ty + (cy - pull.ty) * u;
          cz = pull.tz + (cz - pull.tz) * u;
        }
        pull.ox = cx - bx;
        pull.oy = cy - by;
        pull.oz = cz - bz;
        pull.left = true;
      }
      let ox = pull.ox;
      let oy = pull.oy;
      let oz = pull.oz;
      // The sparkle of the hit goes where the ball is seen to be hit: on the racket.
      if (spark.player === who && !spark.placed && this.struck[who]) {
        spark.dx = bx + ox - spark.x;
        spark.dy = by + oy - spark.y;
        spark.dz = bz + oz - spark.z;
        spark.placed = true;
      }
      const w = racketPull(eta);
      ox *= w;
      oy *= w;
      oz *= w;
      ball.x += ox;
      ball.y += oy;
      ball.z += oz;
      // On the racket it is seen, whatever is nearer the camera, the racket or the body.
      if (w > 0) ball.over = figures[who]!;
      for (let i = 0; i < ball.trailCount * 3; i += 3) {
        ball.trail[i] = ball.trail[i]! + ox;
        ball.trail[i + 1] = ball.trail[i + 1]! + oy;
        ball.trail[i + 2] = ball.trail[i + 2]! + oz;
      }
    }
    if (spark.player < 0) return;
    for (const effect of effects) {
      if (effect.kind !== 'hit' || effect.x !== spark.x || effect.y !== spark.y || effect.z !== spark.z) continue;
      effect.x += spark.dx;
      effect.y += spark.dy;
      effect.z += spark.dz;
    }
  }
}
