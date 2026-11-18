import type { Character, Skeleton } from './character';

/**
 * Bending a limb so that its end is where it has to be.
 *
 * A clip swings through the place where its ball was when it was animated.
 * The real ball is rarely there: it comes higher, lower, further out, and a
 * character is drawn bigger than life while the ball is not. So around the
 * contact the arm is solved backwards (given where the wrist has to be,
 * where does the elbow go), and for a low ball the legs are too, to let the
 * body sink with the feet still on the floor.
 *
 * Arms and legs are both a chain of two bones and an end: shoulder, elbow
 * and wrist; hip, knee and ankle. One function does for all of them.
 *
 * Rotations are quaternions (x, y, z, w). The rotation of a bone seen from
 * the character is the one of its parent times its own.
 */

/** The rotation of every bone in the character's own axes, for a pose. Parents come before their children. */
export function worldRotations(character: Character, pose: Float32Array, out: Float32Array): Float32Array {
  const parents = character.meta.bones.parents;
  for (let i = 0; i < character.bones; i++) {
    const o = i * 4;
    let x = pose[o]!;
    let y = pose[o + 1]!;
    let z = pose[o + 2]!;
    let w = pose[o + 3]!;
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
    x *= inv;
    y *= inv;
    z *= inv;
    w *= inv;
    const parent = parents[i]!;
    if (parent < 0) {
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = w;
    } else {
      const p = parent * 4;
      multiply(out[p]!, out[p + 1]!, out[p + 2]!, out[p + 3]!, x, y, z, w, out, o);
    }
  }
  return out;
}

/** out[at..at+4] = a times b. */
function multiply(
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
  out: Float32Array | number[],
  at: number,
): void {
  out[at] = aw * bx + ax * bw + ay * bz - az * by;
  out[at + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[at + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[at + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** The shortest turn that takes one direction to another. Both have to be of length one. */
function turn(ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, out: number[]): void {
  const dot = ux * vx + uy * vy + uz * vz;
  if (dot < -0.999999) {
    // Opposite: half a turn round anything perpendicular.
    let px = 0;
    let py = -uz;
    let pz = uy;
    if (py * py + pz * pz < 1e-6) {
      px = -uz;
      py = 0;
      pz = ux;
    }
    const inv = 1 / Math.hypot(px, py, pz);
    out[0] = px * inv;
    out[1] = py * inv;
    out[2] = pz * inv;
    out[3] = 0;
    return;
  }
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const w = 1 + dot;
  const inv = 1 / Math.hypot(x, y, z, w);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
  out[3] = w * inv;
}

const d1 = [0, 0, 0, 1];
const d2 = [0, 0, 0, 1];
const upperWorld = [0, 0, 0, 1];
const lowerWorld = [0, 0, 0, 1];
const scratch = [0, 0, 0, 1];

/** A limb: the bones whose joints are its root (shoulder, hip), its middle (elbow, knee) and its end (wrist, ankle). */
export interface Limb {
  upper: number;
  lower: number;
  end: number;
}

/**
 * Bends a limb so that the joint of its end bone is at (tx, ty, tz), in the
 * character's axes, or as near as the limb reaches. The middle joint stays on
 * the side it is on, pushed toward (hx, hy, hz) when that is given. The end
 * bone keeps facing the way it did: a hand does not turn the racket, a foot
 * stays flat.
 *
 * `skeleton` and `world` have to be those of `pose`. The new rotations of the
 * three bones are written into `pose`, and `world` is kept in step; the
 * skeleton has to be solved again afterwards.
 */
export function bendLimb(
  character: Character,
  pose: Float32Array,
  skeleton: Skeleton,
  world: Float32Array,
  limb: Limb,
  tx: number,
  ty: number,
  tz: number,
  hx = 0,
  hy = 0,
  hz = 0,
): void {
  const pos = skeleton.pos;
  const u = limb.upper * 3;
  const l = limb.lower * 3;
  const e = limb.end * 3;
  const sx = pos[u]!;
  const sy = pos[u + 1]!;
  const sz = pos[u + 2]!;
  // The limb as it is.
  let ax = pos[l]! - sx;
  let ay = pos[l + 1]! - sy;
  let az = pos[l + 2]! - sz;
  const l1 = Math.hypot(ax, ay, az);
  let bx = pos[e]! - pos[l]!;
  let by = pos[e + 1]! - pos[l + 1]!;
  let bz = pos[e + 2]! - pos[l + 2]!;
  const l2 = Math.hypot(bx, by, bz);
  if (l1 < 1e-5 || l2 < 1e-5) return;

  // Where the end goes: no further than the limb reaches, no nearer than it folds.
  let dx = tx - sx;
  let dy = ty - sy;
  let dz = tz - sz;
  const wanted = Math.hypot(dx, dy, dz);
  if (wanted < 1e-5) return;
  const d = Math.min(Math.max(wanted, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
  dx /= wanted;
  dy /= wanted;
  dz /= wanted;

  // The middle joint: on the circle where the two bones can meet, on the side the hint says.
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  let px = ax + hx;
  let py = ay + hy;
  let pz = az + hz;
  let dot = px * dx + py * dy + pz * dz;
  px -= dx * dot;
  py -= dy * dot;
  pz -= dz * dot;
  let length = Math.hypot(px, py, pz);
  if (length < 1e-4) {
    // The limb is straight along the way it has to go: any side will do, so take the hint, or just down.
    px = hx || 0;
    py = hy || 0;
    pz = hz || -1;
    dot = px * dx + py * dy + pz * dz;
    px -= dx * dot;
    py -= dy * dot;
    pz -= dz * dot;
    length = Math.hypot(px, py, pz) || 1;
  }
  px /= length;
  py /= length;
  pz /= length;
  const mx = dx * along + px * out;
  const my = dy * along + py * out;
  const mz = dz * along + pz * out;

  // The upper bone turns from where it points to where the middle joint went...
  ax /= l1;
  ay /= l1;
  az /= l1;
  turn(ax, ay, az, mx / l1, my / l1, mz / l1, d1);
  const uq = limb.upper * 4;
  multiply(d1[0]!, d1[1]!, d1[2]!, d1[3]!, world[uq]!, world[uq + 1]!, world[uq + 2]!, world[uq + 3]!, upperWorld, 0);

  // ...which carries the lower bone along; then that one turns the rest of the way to the end.
  bx /= l2;
  by /= l2;
  bz /= l2;
  const qx = d1[0]!;
  const qy = d1[1]!;
  const qz = d1[2]!;
  const qw = d1[3]!;
  // b turned by d1: b + 2 q x (q x b + w b), with q the vector part.
  const cx = qy * bz - qz * by + qw * bx;
  const cy = qz * bx - qx * bz + qw * by;
  const cz = qx * by - qy * bx + qw * bz;
  const rx = bx + 2 * (qy * cz - qz * cy);
  const ry = by + 2 * (qz * cx - qx * cz);
  const rz = bz + 2 * (qx * cy - qy * cx);
  const ex = (dx * d - mx) / l2;
  const ey = (dy * d - my) / l2;
  const ez = (dz * d - mz) / l2;
  turn(rx, ry, rz, ex, ey, ez, d2);
  const lq = limb.lower * 4;
  multiply(d1[0]!, d1[1]!, d1[2]!, d1[3]!, world[lq]!, world[lq + 1]!, world[lq + 2]!, world[lq + 3]!, scratch, 0);
  multiply(d2[0]!, d2[1]!, d2[2]!, d2[3]!, scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!, lowerWorld, 0);

  // Back to rotations relative to the parent, which is what a pose holds.
  const parent = character.meta.bones.parents[limb.upper]!;
  if (parent >= 0) {
    const p = parent * 4;
    multiply(-world[p]!, -world[p + 1]!, -world[p + 2]!, world[p + 3]!, upperWorld[0]!, upperWorld[1]!, upperWorld[2]!, upperWorld[3]!, pose, uq);
  } else {
    for (let c = 0; c < 4; c++) pose[uq + c] = upperWorld[c]!;
  }
  multiply(-upperWorld[0]!, -upperWorld[1]!, -upperWorld[2]!, upperWorld[3]!, lowerWorld[0]!, lowerWorld[1]!, lowerWorld[2]!, lowerWorld[3]!, pose, lq);
  const eq = limb.end * 4;
  multiply(-lowerWorld[0]!, -lowerWorld[1]!, -lowerWorld[2]!, lowerWorld[3]!, world[eq]!, world[eq + 1]!, world[eq + 2]!, world[eq + 3]!, pose, eq);
  for (let c = 0; c < 4; c++) {
    world[uq + c] = upperWorld[c]!;
    world[lq + c] = lowerWorld[c]!;
  }
}
