import type { Character, Skeleton } from './character';

/**
 * Bending a limb so that its end is where it has to be, the way a body bends.
 *
 * A clip swings through the place where its ball was when it was animated.
 * The real ball is rarely there: it comes higher, lower, further out, and a
 * character is drawn bigger than life while the ball is not. So around the
 * contact the arm is solved backwards (given where the wrist has to be,
 * where does the elbow go), and for a low ball the legs are too, to let the
 * body sink with the feet still on the floor. A gesture puts a hand somewhere
 * the same way.
 *
 * Arms and legs are both a chain of two bones and an end: shoulder, elbow
 * and wrist; hip, knee and ankle. An elbow and a knee are hinges: they bend
 * about one axis, one way, from nearly straight to as far as a person's go,
 * and never sideways or backward. So the limb is first bent about its hinge,
 * only as much as the distance to the target asks for, and then the whole of
 * it is turned from the shoulder or the hip to point there: the hinge goes
 * with it, and the elbow stays on the side the clip has it. Near full stretch
 * it straightens more and more slowly instead of locking.
 *
 * A wrist is not a hinge: it bends, tilts and turns, each within its range.
 * Whatever the clips, the reach and the gestures ask of it, a last pass keeps
 * every hand within that range.
 *
 * Rotations are quaternions (x, y, z, w). The rotation of a bone seen from
 * the character is the one of its parent times its own.
 */

const RAD = Math.PI / 180;

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
    const inv = 1 / Math.sqrt(px * px + py * py + pz * pz);
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
  const inv = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
  out[3] = w * inv;
}

/** A vector turned by a quaternion: v + 2 q x (q x v + w v), with q the vector part. */
function rotate(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number, out: number[]): void {
  const cx = qy * vz - qz * vy + qw * vx;
  const cy = qz * vx - qx * vz + qw * vy;
  const cz = qx * vy - qy * vx + qw * vz;
  out[0] = vx + 2 * (qy * cz - qz * cy);
  out[1] = vy + 2 * (qz * cx - qx * cz);
  out[2] = vz + 2 * (qx * cy - qy * cx);
}

/**
 * A limb: the bones whose joints are its root (shoulder, hip), its middle
 * (elbow, knee) and its end (wrist, ankle), and how its middle joint bends:
 * about which axis of the upper bone, which way round, and from how little to
 * how much, in radians. Near full stretch it straightens more and more slowly
 * instead of locking, from `soft` of its length short of it.
 */
export interface Limb {
  upper: number;
  lower: number;
  end: number;
  hinge: 0 | 1 | 2;
  sign: 1 | -1;
  least: number;
  most: number;
  soft: number;
}

/**
 * From nearly straight to as far as a person's go. Never all the way
 * straight: a limb that locks looks rigid, and it would not know which way
 * to bend back. An arm reaching out slows down before it is straight; a leg
 * goes all the way, because a foot on the floor has to stay where it is.
 */
const ELBOW = { least: 2 * RAD, most: 145 * RAD, soft: 0.04 };
const KNEE = { least: 2 * RAD, most: 150 * RAD, soft: 0 };

/**
 * An arm. In the T pose the skeleton has at rest, an elbow bends about the
 * upper arm's own z, the left one one way round and the right one the other.
 */
export function armOf(character: Character, side: 'L' | 'R'): Limb {
  return {
    upper: character.bone(`upper_arm.${side}`),
    lower: character.bone(`forearm.${side}`),
    end: character.bone(`hand.${side}`),
    hinge: 2,
    sign: side === 'R' ? 1 : -1,
    ...ELBOW,
  };
}

/** A leg. A knee bends about the thigh's own x, both the same way round. */
export function legOf(character: Character, side: 'L' | 'R'): Limb {
  return {
    upper: character.bone(`thigh.${side}`),
    lower: character.bone(`shin.${side}`),
    end: character.bone(`foot.${side}`),
    hinge: 0,
    sign: 1,
    ...KNEE,
  };
}

const hinge = [0, 0, 0];
const moved = [0, 0, 0];
const bend = [0, 0, 0, 1];
const aim = [0, 0, 0, 1];
const upperWorld = [0, 0, 0, 1];
const lowerWorld = [0, 0, 0, 1];
const scratch = [0, 0, 0, 1];

/** How bent the middle joint of a limb is, in radians: positive is the way it bends. `skeleton` and `world` have to be those of the pose. */
export function flexion(skeleton: Skeleton, world: ArrayLike<number>, limb: Limb): number {
  const pos = skeleton.pos;
  const u = limb.upper * 3;
  const l = limb.lower * 3;
  const e = limb.end * 3;
  const ax = pos[l]! - pos[u]!;
  const ay = pos[l + 1]! - pos[u + 1]!;
  const az = pos[l + 2]! - pos[u + 2]!;
  const bx = pos[e]! - pos[l]!;
  const by = pos[e + 1]! - pos[l + 1]!;
  const bz = pos[e + 2]! - pos[l + 2]!;
  const q = limb.upper * 4;
  rotate(world[q]!, world[q + 1]!, world[q + 2]!, world[q + 3]!, limb.hinge === 0 ? 1 : 0, limb.hinge === 1 ? 1 : 0, limb.hinge === 2 ? 1 : 0, hinge);
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return limb.sign * Math.atan2(cx * hinge[0]! + cy * hinge[1]! + cz * hinge[2]!, ax * bx + ay * by + az * bz);
}

/**
 * Bends a limb so that a point it carries is at (tx, ty, tz), in the
 * character's axes, or as near as the limb gets: its middle joint bends only
 * about its hinge and only as far as it goes, and the whole limb turns from
 * its root toward the target by the shortest way, so the middle joint stays
 * on the side the pose has it. A joint the pose already has beyond its range
 * is not taken further.
 *
 * The point is the joint of the end bone, which keeps facing the way it did
 * in the character's axes: a foot stays flat, and a hand put somewhere keeps
 * its turn (its wrist is kept in range afterwards, see `keepWrist`). Or it is
 * `tip`, a point that goes with the lower bone because the end bone keeps its
 * turn on it: the middle of a racket, with the wrist as it is.
 *
 * With the target where the point already is, nothing changes: a reach that
 * fades in and out never jumps.
 *
 * `skeleton` and `world` have to be those of `pose`. The new rotations of the
 * three bones are written into `pose`, and `world` is kept in step; the
 * skeleton has to be solved again afterwards.
 */
export function reachLimb(
  character: Character,
  pose: Float32Array,
  skeleton: Skeleton,
  world: Float32Array,
  limb: Limb,
  tx: number,
  ty: number,
  tz: number,
  tip: ArrayLike<number> | null = null,
): void {
  const pos = skeleton.pos;
  const u = limb.upper * 3;
  const l = limb.lower * 3;
  const e = limb.end * 3;
  const sx = pos[u]!;
  const sy = pos[u + 1]!;
  const sz = pos[u + 2]!;
  // The upper bone, and the point from the middle joint.
  const ax = pos[l]! - sx;
  const ay = pos[l + 1]! - sy;
  const az = pos[l + 2]! - sz;
  const l1 = Math.sqrt(ax * ax + ay * ay + az * az);
  const vx = (tip ? tip[0]! : pos[e]!) - pos[l]!;
  const vy = (tip ? tip[1]! : pos[e + 1]!) - pos[l + 1]!;
  const vz = (tip ? tip[2]! : pos[e + 2]!) - pos[l + 2]!;
  const l2 = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const wanted = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l1 < 1e-5 || l2 < 1e-5 || wanted < 1e-5) return;

  // Bending turns the point round the hinge: what is off the hinge goes round, what is along it stays.
  const now = flexion(skeleton, world, limb);
  const nx = hinge[0]!;
  const ny = hinge[1]!;
  const nz = hinge[2]!;
  const va = vx * nx + vy * ny + vz * nz;
  const qx = vx - nx * va;
  const qy = vy - ny * va;
  const qz = vz - nz * va;
  const aa = ax * nx + ay * ny + az * nz;
  const px = ax - nx * aa;
  const py = ay - ny * aa;
  const pz = az - nz * aa;
  const r = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const rp = Math.sqrt(px * px + py * py + pz * pz);
  if (r < 1e-6 || rp < 1e-6) return;
  // How far the point is from the root after a turn `t` round the hinge is the root of base + span cos(start + t).
  const base = l1 * l1 + l2 * l2 + 2 * aa * va;
  const span = 2 * rp * r;
  const start = Math.atan2(nx * (py * qz - pz * qy) + ny * (pz * qx - px * qz) + nz * (px * qy - py * qx), px * qx + py * qy + pz * qz);

  // How far it can turn each way: the joint bends between its ends, and never further out of them than it is.
  const lo = limb.sign * (Math.min(limb.least, Math.max(now, 0)) - now);
  const hi = limb.sign * (Math.max(limb.most, now) - now);
  const first = Math.min(lo, hi);
  const last = Math.max(lo, hi);
  // The furthest and the nearest the point gets from the root within that.
  const atFirst = Math.sqrt(Math.max(0, base + span * Math.cos(start + first)));
  const atLast = Math.sqrt(Math.max(0, base + span * Math.cos(start + last)));
  let far = Math.max(atFirst, atLast);
  let near = Math.min(atFirst, atLast);
  for (let k = -1; k <= 1; k++) {
    const stretched = 2 * Math.PI * k - start;
    if (stretched >= first && stretched <= last) far = Math.sqrt(Math.max(0, base + span));
    const folded = Math.PI + 2 * Math.PI * k - start;
    if (folded >= first && folded <= last) near = Math.sqrt(Math.max(0, base - span));
  }
  // Toward full stretch it gives less and less: from where it already is, or from a little short of it.
  const from = Math.sqrt(Math.max(0, base + span * Math.cos(start)));
  const knee = Math.max(Math.min(from, far), far - limb.soft * (l1 + l2));
  let d = wanted;
  if (d > knee) {
    const room = far - knee;
    d = room > 1e-6 ? knee + room * (1 - Math.exp(-(d - knee) / room)) : far;
  }
  d = Math.min(far, Math.max(near, d));
  // The turn that gets it there: the smallest one, or the end of the range that gets nearest.
  const angle = Math.acos(Math.min(1, Math.max(-1, (d * d - base) / span)));
  let spin = Number.NaN;
  for (let k = -1; k <= 1; k++) {
    const a = angle - start + 2 * Math.PI * k;
    if (a >= first - 1e-9 && a <= last + 1e-9 && !(Math.abs(a) >= Math.abs(spin))) spin = a;
    const b = -angle - start + 2 * Math.PI * k;
    if (b >= first - 1e-9 && b <= last + 1e-9 && !(Math.abs(b) >= Math.abs(spin))) spin = b;
  }
  if (Number.isNaN(spin)) spin = Math.abs(atFirst - d) < Math.abs(atLast - d) ? first : last;

  // 1. The middle joint bends about its hinge, and only about it.
  const s = Math.sin(spin / 2);
  bend[0] = nx * s;
  bend[1] = ny * s;
  bend[2] = nz * s;
  bend[3] = Math.cos(spin / 2);
  rotate(bend[0]!, bend[1]!, bend[2]!, bend[3]!, vx, vy, vz, moved);
  // Where the point is after that, from the root.
  const ex = ax + moved[0]!;
  const ey = ay + moved[1]!;
  const ez = az + moved[2]!;
  const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (el < 1e-6) return;

  // 2. The whole limb turns from its root to point there, by the shortest way: the hinge goes with it, so the
  // bend stays in its plane, and that plane turns as little as it can from the one the clip has. Turning it
  // round toward where the clip has the knee instead can swing a leg half way round its hip.
  turn(ex / el, ey / el, ez / el, dx / wanted, dy / wanted, dz / wanted, aim);
  const uq = limb.upper * 4;
  const lq = limb.lower * 4;
  const eq = limb.end * 4;
  multiply(aim[0]!, aim[1]!, aim[2]!, aim[3]!, world[uq]!, world[uq + 1]!, world[uq + 2]!, world[uq + 3]!, upperWorld, 0);
  multiply(bend[0]!, bend[1]!, bend[2]!, bend[3]!, world[lq]!, world[lq + 1]!, world[lq + 2]!, world[lq + 3]!, scratch, 0);
  multiply(aim[0]!, aim[1]!, aim[2]!, aim[3]!, scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!, lowerWorld, 0);

  // Back to rotations relative to the parent, which is what a pose holds.
  const parent = character.meta.bones.parents[limb.upper]!;
  if (parent >= 0) {
    const p = parent * 4;
    multiply(-world[p]!, -world[p + 1]!, -world[p + 2]!, world[p + 3]!, upperWorld[0]!, upperWorld[1]!, upperWorld[2]!, upperWorld[3]!, pose, uq);
  } else {
    for (let c = 0; c < 4; c++) pose[uq + c] = upperWorld[c]!;
  }
  multiply(-upperWorld[0]!, -upperWorld[1]!, -upperWorld[2]!, upperWorld[3]!, lowerWorld[0]!, lowerWorld[1]!, lowerWorld[2]!, lowerWorld[3]!, pose, lq);
  if (tip) {
    // The end keeps its turn on the lower bone.
    multiply(lowerWorld[0]!, lowerWorld[1]!, lowerWorld[2]!, lowerWorld[3]!, pose[eq]!, pose[eq + 1]!, pose[eq + 2]!, pose[eq + 3]!, world, eq);
  } else {
    // The end keeps its turn in the character's axes.
    multiply(-lowerWorld[0]!, -lowerWorld[1]!, -lowerWorld[2]!, lowerWorld[3]!, world[eq]!, world[eq + 1]!, world[eq + 2]!, world[eq + 3]!, pose, eq);
  }
  for (let c = 0; c < 4; c++) {
    world[uq + c] = upperWorld[c]!;
    world[lq + c] = lowerWorld[c]!;
  }
}

const swivelAxis = [0, 0, 0];
const swivelTurn = [0, 0, 0, 1];

/**
 * Turns a limb about the line from its root to its end, so that its middle
 * joint points as near a direction (px, py, pz) as it can, `amount` (0..1) of
 * the way: the end stays where it is, and so does the bend. It is how a
 * person picks where the elbow goes for a hand put somewhere: out to the side
 * for one raised over the head, down for one held out. Seen from behind or
 * from the front a bend toward the camera hides; one to the side shows.
 *
 * Only the upper bone turns: the rest of the limb goes with it. `skeleton`
 * has to be solved for `pose`, and `world` has to be its rotations; the new
 * rotation is written into `pose`, `world` is kept in step for the three
 * bones, and the skeleton has to be solved again afterwards.
 */
export function swivelLimb(
  character: Character,
  pose: Float32Array,
  skeleton: Skeleton,
  world: Float32Array,
  limb: Limb,
  px: number,
  py: number,
  pz: number,
  amount = 1,
): void {
  const pos = skeleton.pos;
  const u = limb.upper * 3;
  const l = limb.lower * 3;
  const e = limb.end * 3;
  // The line from the root to the end.
  let ax = pos[e]! - pos[u]!;
  let ay = pos[e + 1]! - pos[u + 1]!;
  let az = pos[e + 2]! - pos[u + 2]!;
  const length = Math.sqrt(ax * ax + ay * ay + az * az);
  if (length < 1e-5 || amount <= 0) return;
  ax /= length;
  ay /= length;
  az /= length;
  // Where the middle joint is off that line, and where it should be: both square to it.
  let mx = pos[l]! - pos[u]!;
  let my = pos[l + 1]! - pos[u + 1]!;
  let mz = pos[l + 2]! - pos[u + 2]!;
  const along = mx * ax + my * ay + mz * az;
  mx -= ax * along;
  my -= ay * along;
  mz -= az * along;
  const wanted = px * ax + py * ay + pz * az;
  const wx = px - ax * wanted;
  const wy = py - ay * wanted;
  const wz = pz - az * wanted;
  // A limb nearly straight has no middle joint off the line to speak of: nothing to turn.
  if (Math.sqrt(mx * mx + my * my + mz * mz) < 1e-3 || Math.sqrt(wx * wx + wy * wy + wz * wz) < 1e-5) return;
  const angle = Math.atan2(ax * (my * wz - mz * wy) + ay * (mz * wx - mx * wz) + az * (mx * wy - my * wx), mx * wx + my * wy + mz * wz) * amount;
  const s = Math.sin(angle / 2);
  swivelAxis[0] = ax;
  swivelAxis[1] = ay;
  swivelAxis[2] = az;
  swivelTurn[0] = ax * s;
  swivelTurn[1] = ay * s;
  swivelTurn[2] = az * s;
  swivelTurn[3] = Math.cos(angle / 2);
  const uq = limb.upper * 4;
  const lq = limb.lower * 4;
  const eq = limb.end * 4;
  for (const q of [uq, lq, eq]) {
    multiply(swivelTurn[0]!, swivelTurn[1]!, swivelTurn[2]!, swivelTurn[3]!, world[q]!, world[q + 1]!, world[q + 2]!, world[q + 3]!, scratch, 0);
    for (let c = 0; c < 4; c++) world[q + c] = scratch[c]!;
  }
  // Back to a rotation relative to the parent, which is what a pose holds.
  const parent = character.meta.bones.parents[limb.upper]!;
  if (parent >= 0) {
    const p = parent * 4;
    multiply(-world[p]!, -world[p + 1]!, -world[p + 2]!, world[p + 3]!, world[uq]!, world[uq + 1]!, world[uq + 2]!, world[uq + 3]!, pose, uq);
  } else {
    for (let c = 0; c < 4; c++) pose[uq + c] = world[uq + c]!;
  }
}

/**
 * How far a wrist goes, in radians: it bends forward (flexion) and back
 * (extension), tilts toward the thumb (radial) and toward the little finger
 * (ulnar), and turns with the forearm (pronation, supination). A little
 * inside what a person does comfortably, so that what is shown never looks
 * strained.
 */
const WRIST = { flexion: 73 * RAD, extension: 63 * RAD, radial: 18 * RAD, ulnar: 33 * RAD, pronation: 78 * RAD, supination: 83 * RAD };
/**
 * The racket of the model crosses the fist square to the forearm, like a
 * hammer. A player holds the handle across the palm on a slant: the wrist of
 * the racket hand is measured from there, this far toward the little finger.
 */
const GRIP = 45 * RAD;
/**
 * A hand turned nearly half way round on its forearm (in a clip) could be
 * brought back either way. It is kept on the side it was held at, unless the
 * other one gets nearer than this.
 */
const TURN_STICKS = 40 * RAD;
/**
 * The fastest a hand turns on its forearm, in radians a second: a wrist that
 * snaps in a hit is about as fast, for a frame or two. Faster is a hand
 * flipping over from one frame to the next, which a clip does when it turns
 * the racket by where it points rather than by its rotation: it is spread
 * over a few frames.
 */
const WRIST_SPEED = 1500 * RAD;

/**
 * A wrist to keep in range: the bone of the hand, whether it is the right one
 * (mirrored to measure it) and whether it holds the racket. And what it did at
 * the last frame: which way round its turn was held (1 pronation, -1
 * supination, 0 within range), the turn it was left with, if it was, and the
 * turn it was going for, which it may not have got to for turning no faster
 * than a wrist does.
 */
export interface Wrist {
  bone: number;
  right: boolean;
  racket: boolean;
  held: number;
  last: Float32Array;
  wanted: Float32Array;
  kept: boolean;
}

export function wristOf(character: Character, side: 'L' | 'R', racket: boolean): Wrist {
  return { bone: character.bone(`hand.${side}`), right: side === 'R', racket, held: 0, last: new Float32Array(4), wanted: new Float32Array([0, 0, 0, 1]), kept: false };
}

const GRIP_Z = Math.sin(-GRIP / 2);
const GRIP_W = Math.cos(-GRIP / 2);
const q = [0, 0, 0, 1];
const kept = [0, 0, 0, 1];

/**
 * Brings the turn of a hand on its forearm (as a pose holds it, of length one)
 * within what a wrist does, into `out`. The turn is split into a turn about
 * the forearm (the twist: pronation and supination) and a swing of the hand,
 * and each is brought back within its range: the swing within an ellipse of
 * bending and tilting, the twist within its two ends. Returns whether it had
 * to; `out` is left alone if not.
 */
function clampWrist(x: number, y: number, z: number, w: number, wrist: Wrist, out: number[]): boolean {
  // Measured as a left hand, and for the racket hand from the way a racket is held.
  if (wrist.right) {
    y = -y;
    z = -z;
  }
  if (wrist.racket) {
    multiply(x, y, z, w, 0, 0, GRIP_Z, GRIP_W, q, 0);
    x = q[0]!;
    y = q[1]!;
    z = q[2]!;
    w = q[3]!;
  }
  // The twist, about the forearm (x), and the swing that is left: q = swing twist.
  const tn = Math.sqrt(x * x + w * w);
  let twist = tn > 1e-9 ? 2 * Math.atan2(x / tn, w / tn) : 0;
  if (twist > Math.PI) twist -= 2 * Math.PI;
  if (twist < -Math.PI) twist += 2 * Math.PI;
  const tx = tn > 1e-9 ? x / tn : 0;
  const tw = tn > 1e-9 ? w / tn : 1;
  multiply(x, y, z, w, -tx, 0, 0, tw, q, 0);
  let sy = q[1]!;
  let sz = q[2]!;
  let sw = q[3]!;
  if (sw < 0) {
    sy = -sy;
    sz = -sz;
    sw = -sw;
  }
  const sn = Math.sqrt(sy * sy + sz * sz);
  const angle = 2 * Math.atan2(sn, sw);
  let ry = sn > 1e-9 ? (sy / sn) * angle : 0;
  let rz = sn > 1e-9 ? (sz / sn) * angle : 0;

  let changed = false;
  const hi = WRIST.pronation;
  const lo = -WRIST.supination;
  if (twist > hi || twist < lo) {
    // Beyond one end: back to the nearer one, going round the back if that is nearer, but not changing
    // sides for a hand that hovers about half a turn.
    const toHi = twist > hi ? twist - hi : twist + 2 * Math.PI - hi;
    const toLo = twist < lo ? lo - twist : lo + 2 * Math.PI - twist;
    let side = toHi <= toLo ? 1 : -1;
    if (wrist.held !== 0 && side !== wrist.held && Math.abs(toHi - toLo) < TURN_STICKS) side = wrist.held;
    twist = side > 0 ? hi : lo;
    wrist.held = side;
    changed = true;
  } else {
    wrist.held = 0;
  }
  const ay = ry >= 0 ? WRIST.flexion : WRIST.extension;
  const az = rz >= 0 ? WRIST.ulnar : WRIST.radial;
  const e = (ry / ay) * (ry / ay) + (rz / az) * (rz / az);
  if (e > 1) {
    const k = 1 / Math.sqrt(e);
    ry *= k;
    rz *= k;
    changed = true;
  }
  if (!changed) return false;
  // Put back together: swing twist, then back to the hand as it is held and to its own side.
  const a = Math.sqrt(ry * ry + rz * rz);
  const s = a > 1e-9 ? Math.sin(a / 2) / a : 0.5;
  const ht = twist / 2;
  multiply(0, ry * s, rz * s, Math.cos(a / 2), Math.sin(ht), 0, 0, Math.cos(ht), q, 0);
  if (wrist.racket) multiply(q[0]!, q[1]!, q[2]!, q[3]!, 0, 0, -GRIP_Z, GRIP_W, q, 0);
  out[0] = q[0]!;
  out[1] = wrist.right ? -q[1]! : q[1]!;
  out[2] = wrist.right ? -q[2]! : q[2]!;
  out[3] = q[3]!;
  return true;
}

/**
 * Keeps the turn of a hand on its forearm within what a wrist does (see
 * `clampWrist`). `pose` holds it relative to the forearm, so nothing else has
 * to be known; the skeleton has to be solved again afterwards. Within range
 * nothing changes.
 *
 * With `dt`, the seconds since the last frame, the hand is also kept from
 * turning faster than a wrist does (see `WRIST_SPEED`) from where it was left
 * at the last frame: none, the same moment drawn again, leaves it where it
 * was. `wrist.kept` false starts afresh.
 */
export function keepWrist(pose: Float32Array, wrist: Wrist, dt: number | null = null): void {
  const o = wrist.bone * 4;
  if (wrist.bone < 0) return;
  let x = pose[o]!;
  let y = pose[o + 1]!;
  let z = pose[o + 2]!;
  let w = pose[o + 3]!;
  const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  const sign = w < 0 ? -1 / length : 1 / length;
  kept[0] = x * sign;
  kept[1] = y * sign;
  kept[2] = z * sign;
  kept[3] = w * sign;
  let changed = clampWrist(kept[0], kept[1], kept[2], kept[3], wrist, kept);
  if (dt !== null) {
    const last = wrist.last;
    for (let c = 0; c < 4; c++) wrist.wanted[c] = kept[c]!;
    if (wrist.kept) {
      // No faster than a wrist turns, from where it was left; then within range again, which a turn between two
      // that are within it may not quite be.
      x = kept[0];
      y = kept[1];
      z = kept[2];
      w = kept[3];
      let d = last[0]! * x + last[1]! * y + last[2]! * z + last[3]! * w;
      if (d < 0) {
        x = -x;
        y = -y;
        z = -z;
        w = -w;
        d = -d;
      }
      const half = Math.acos(Math.min(1, d));
      const most = (WRIST_SPEED * dt) / 2;
      if (half > most) {
        const s = Math.sin(half);
        const stay = Math.sin(half - most) / s;
        const go = Math.sin(most) / s;
        x = last[0]! * stay + x * go;
        y = last[1]! * stay + y * go;
        z = last[2]! * stay + z * go;
        w = last[3]! * stay + w * go;
        const n = (w < 0 ? -1 : 1) / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
        kept[0] = x * n;
        kept[1] = y * n;
        kept[2] = z * n;
        kept[3] = w * n;
        clampWrist(kept[0], kept[1], kept[2], kept[3], wrist, kept);
        changed = true;
      }
    }
    for (let c = 0; c < 4; c++) last[c] = kept[c]!;
    wrist.kept = true;
  }
  if (!changed) return;
  for (let c = 0; c < 4; c++) pose[o + c] = kept[c]!;
}

/**
 * How far an elbow bends, in radians: from a little past straight, as some
 * are, to as far as a person's go. Clips and the width a character gives its
 * gestures can take it beyond; the reach never does (see `reachLimb`).
 */
const ELBOW_RANGE = { least: -4 * RAD, most: 145 * RAD };

/** An elbow to keep in range: the bones of the forearm and of the hand, and whether it is the right one (mirrored to measure it). */
export interface Elbow {
  bone: number;
  hand: number;
  right: boolean;
}

export function elbowOf(character: Character, side: 'L' | 'R'): Elbow {
  return { bone: character.bone(`forearm.${side}`), hand: character.bone(`hand.${side}`), right: side === 'R' };
}

/**
 * Keeps an elbow a hinge, bent within its range. `pose` holds the turn of the
 * forearm on the upper arm and of the hand on the forearm; the skeleton has
 * to be solved again afterwards.
 *
 * An elbow does not turn the forearm about itself: the hand does, from the
 * wrist. A clip whose arm goes nearly straight can leave the forearm turned
 * half way round about itself, with the hand turned back to keep the racket
 * where it goes; that turn is handed to the wrist, which leaves the hand
 * where it was. Then the bend is brought within range, about the hinge only,
 * and the hand goes with it.
 */
export function keepElbow(pose: Float32Array, elbow: Elbow): void {
  const o = elbow.bone * 4;
  const h = elbow.hand * 4;
  if (elbow.bone < 0 || elbow.hand < 0) return;
  let x = pose[o]!;
  let y = pose[o + 1]!;
  let z = pose[o + 2]!;
  let w = pose[o + 3]!;
  // Most of the time it is a hinge bent within its range already: a turn about z alone, between the ends.
  if (x === 0 && y === 0) {
    const bent = -2 * Math.atan2(elbow.right ? -z : z, w);
    const folded = bent < -Math.PI / 2 ? bent + 2 * Math.PI : bent;
    if (folded >= ELBOW_RANGE.least && folded <= ELBOW_RANGE.most) return;
  }
  const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  const sign = w < 0 ? -1 / length : 1 / length;
  x *= sign;
  y *= sign;
  z *= sign;
  w *= sign;
  // The turn of the forearm about itself (x), and the swing that bends it: forearm = swing twist.
  const tn = Math.sqrt(x * x + w * w);
  const tx = tn > 1e-9 ? x / tn : 0;
  const tw = tn > 1e-9 ? w / tn : 1;
  multiply(x, y, z, w, -tx, 0, 0, tw, q, 0);
  let sy = q[1]!;
  let sz = q[2]!;
  let sw = q[3]!;
  if (sw < 0) {
    sy = -sy;
    sz = -sz;
    sw = -sw;
  }
  // The bend, as a left arm has it: a turn the negative way about z; half a turn the other way is bent too far.
  const sn = Math.sqrt(sy * sy + sz * sz);
  const angle = 2 * Math.atan2(sn, sw);
  const ry = sn > 1e-9 ? (sy / sn) * angle : 0;
  let rz = sn > 1e-9 ? (sz / sn) * angle : 0;
  const side = elbow.right ? -1 : 1;
  let bent = -rz * side;
  if (bent < -Math.PI / 2) bent += 2 * Math.PI;
  const turned = Math.abs(tx) > 1e-6;
  const out = bent < ELBOW_RANGE.least || bent > ELBOW_RANGE.most;
  if (!turned && !out) return;
  if (out) rz = -Math.min(ELBOW_RANGE.most, Math.max(ELBOW_RANGE.least, bent)) * side;
  const a = Math.sqrt(ry * ry + rz * rz);
  const s = a > 1e-9 ? Math.sin(a / 2) / a : 0.5;
  pose[o] = 0;
  pose[o + 1] = ry * s;
  pose[o + 2] = rz * s;
  pose[o + 3] = Math.cos(a / 2);
  // The hand takes the turn the forearm had about itself.
  if (turned) multiply(tx, 0, 0, tw, pose[h]!, pose[h + 1]!, pose[h + 2]!, pose[h + 3]!, pose, h);
}
