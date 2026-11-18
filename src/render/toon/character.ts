/**
 * The character: one small mesh with a skeleton, shared by everybody on
 * court, and its animation clips. It comes in a single file made by the
 * Blender scripts in design/ (magic `PAD1`, a JSON header, then the numbers).
 *
 * A pose is, for every bone, a rotation relative to its parent (a quaternion)
 * plus the position of the pelvis. The skeleton has no rest rotations: with
 * every rotation at identity the character stands in its T pose.
 *
 * The character's own axes, in metres at life size: it stands on the origin
 * facing -y, with x to its left and z up.
 */
export interface ClipInfo {
  name: string;
  /** Seconds. */
  dur: number;
  loop: boolean;
  frames: number;
  /** Offset so that one frame falls exactly on the contact. */
  t0?: number;
  /** For a stroke: the moment the racket meets the ball. */
  contact?: number;
  /** For a stroke: where the middle of the racket is at that moment. */
  hit?: [number, number, number];
  /** For a stroke: where the hand is at that moment. Newer files carry it. */
  hand?: [number, number, number];
  /** For a way of moving: metres covered by one cycle. Newer files carry it. */
  stride?: number;
  /** For the serve: where the free hand holds the ball, and when it lets go. */
  ballHold?: [[number, number, number], [number, number, number]];
  release?: number;
}

export interface Clip extends ClipInfo {
  /** Per frame: a quaternion for every bone, then the pelvis. */
  samples: Float32Array;
}

export interface CharacterMeta {
  version: number;
  mesh: {
    nv: number;
    ni: number;
    center: [number, number, number];
    half: [number, number, number];
    pos: number;
    nrm: number;
    mat: number;
    out: number;
    joints: number;
    weights: number;
    idx: number;
  };
  materials: string[];
  /** Materials drawn flat, without the light steps: eyes, brows, mouth. */
  flat: boolean[];
  /** A colour for every material, for every look that came in the file. */
  palettes: Record<string, Array<[number, number, number]>>;
  ink: [number, number, number];
  shadowTint: [number, number, number];
  lightGain: [number, number, number];
  rimColor: [number, number, number];
  bones: { names: string[]; parents: number[]; rest: Array<[number, number, number]> };
  /** Middle of the racket head, in the axes of the racket bone. */
  racketCenter: [number, number, number];
  fps: number;
  clips: Array<ClipInfo & { data: number }>;
}

export interface Character {
  meta: CharacterMeta;
  pos: Int16Array;
  nrm: Int8Array;
  mat: Uint8Array;
  out: Uint8Array;
  joints: Uint8Array;
  weights: Uint8Array;
  idx: Uint16Array;
  clips: Record<string, Clip>;
  /** Number of bones, and of numbers in a pose. */
  bones: number;
  poseSize: number;
  bone(name: string): number;
}

export function parseCharacter(buffer: ArrayBuffer): Character {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PAD1') throw new Error('Unknown character format');
  const headerLength = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as CharacterMeta;
  const base = 8 + headerLength;
  const mesh = meta.mesh;
  const bones = meta.bones.names.length;
  const channels = bones * 4 + 3;

  const clips: Record<string, Clip> = {};
  for (const info of meta.clips) {
    const packed = new Int16Array(buffer, base + info.data, channels * info.frames);
    const samples = new Float32Array(channels * info.frames);
    for (let k = 0; k < channels; k++) {
      // Rotations are stored in 1/32767ths and the pelvis in tenths of a
      // millimetre, each as the difference from the frame before, in 16 bits
      // that wrap around: they are added up the same way.
      const unit = k < bones * 4 ? 1 / 32767 : 1 / 10000;
      let total = 0;
      for (let f = 0; f < info.frames; f++) {
        total = ((total + packed[k * info.frames + f]! + 32768) & 0xffff) - 32768;
        samples[f * channels + k] = total * unit;
      }
    }
    const { data: _data, ...rest } = info;
    void _data;
    clips[info.name] = { ...rest, samples };
  }

  const names = meta.bones.names;
  return {
    meta,
    pos: new Int16Array(buffer, base + mesh.pos, mesh.nv * 3),
    nrm: new Int8Array(buffer, base + mesh.nrm, mesh.nv * 3),
    mat: new Uint8Array(buffer, base + mesh.mat, mesh.nv),
    out: new Uint8Array(buffer, base + mesh.out, mesh.nv),
    joints: new Uint8Array(buffer, base + mesh.joints, mesh.nv * 3),
    weights: new Uint8Array(buffer, base + mesh.weights, mesh.nv * 2),
    idx: new Uint16Array(buffer, base + mesh.idx, mesh.ni),
    clips,
    bones,
    poseSize: channels,
    bone: (name) => names.indexOf(name),
  };
}

/** The pose of a clip at a moment, interpolated between its frames. */
export function samplePose(character: Character, clip: Clip, time: number, out: Float32Array): Float32Array {
  const bones = character.bones;
  const size = character.poseSize;
  let f = (time - (clip.t0 ?? 0)) * character.meta.fps;
  let f0: number;
  let f1: number;
  if (clip.loop) {
    f = ((f % clip.frames) + clip.frames) % clip.frames;
    f0 = Math.floor(f);
    f1 = (f0 + 1) % clip.frames;
  } else {
    f = Math.min(Math.max(f, 0), clip.frames - 1);
    f0 = Math.floor(f);
    f1 = Math.min(clip.frames - 1, f0 + 1);
  }
  const u = f - f0;
  const s = clip.samples;
  const a = f0 * size;
  const b = f1 * size;
  for (let i = 0; i < bones; i++) {
    const k = i * 4;
    const dot = s[a + k]! * s[b + k]! + s[a + k + 1]! * s[b + k + 1]! + s[a + k + 2]! * s[b + k + 2]! + s[a + k + 3]! * s[b + k + 3]!;
    const sign = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) out[k + c] = s[a + k + c]! * (1 - u) + s[b + k + c]! * u * sign;
  }
  for (let c = 0; c < 3; c++) out[bones * 4 + c] = s[a + bones * 4 + c]! * (1 - u) + s[b + bones * 4 + c]! * u;
  return out;
}

/** A pose between two others: `w` of `b` and the rest of `a`. `out` may be either of them. */
export function blendPose(bones: number, a: Float32Array, b: Float32Array, w: number, out: Float32Array): Float32Array {
  for (let i = 0; i < bones; i++) {
    const k = i * 4;
    const dot = a[k]! * b[k]! + a[k + 1]! * b[k + 1]! + a[k + 2]! * b[k + 2]! + a[k + 3]! * b[k + 3]!;
    const sign = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) out[k + c] = a[k + c]! * (1 - w) + b[k + c]! * w * sign;
  }
  for (let c = 0; c < 3; c++) out[bones * 4 + c] = a[bones * 4 + c]! * (1 - w) + b[bones * 4 + c]! * w;
  return out;
}

/** Where every bone ended up: its rotation in the character's axes (3 x 3, by rows) and the position of its joint. */
export interface Skeleton {
  rot: Float32Array;
  pos: Float32Array;
}

export function createSkeleton(character: Character): Skeleton {
  return { rot: new Float32Array(character.bones * 9), pos: new Float32Array(character.bones * 3) };
}

/**
 * Works out the skeleton of a pose: the rotation and the joint of every bone
 * in the character's own axes. Parents come before their children in the file.
 */
export function solveSkeleton(character: Character, pose: Float32Array, skeleton: Skeleton): Skeleton {
  const { parents, rest } = character.meta.bones;
  const bones = character.bones;
  const { rot, pos } = skeleton;
  for (let i = 0; i < bones; i++) {
    const k = i * 4;
    let x = pose[k]!;
    let y = pose[k + 1]!;
    let z = pose[k + 2]!;
    let w = pose[k + 3]!;
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
    x *= inv;
    y *= inv;
    z *= inv;
    w *= inv;
    // The local rotation, by rows.
    const r0 = 1 - 2 * (y * y + z * z);
    const r1 = 2 * (x * y - z * w);
    const r2 = 2 * (x * z + y * w);
    const r3 = 2 * (x * y + z * w);
    const r4 = 1 - 2 * (x * x + z * z);
    const r5 = 2 * (y * z - x * w);
    const r6 = 2 * (x * z - y * w);
    const r7 = 2 * (y * z + x * w);
    const r8 = 1 - 2 * (x * x + y * y);
    const parent = parents[i]!;
    const o = i * 9;
    if (parent < 0) {
      rot[o] = r0;
      rot[o + 1] = r1;
      rot[o + 2] = r2;
      rot[o + 3] = r3;
      rot[o + 4] = r4;
      rot[o + 5] = r5;
      rot[o + 6] = r6;
      rot[o + 7] = r7;
      rot[o + 8] = r8;
      pos[i * 3] = pose[bones * 4]!;
      pos[i * 3 + 1] = pose[bones * 4 + 1]!;
      pos[i * 3 + 2] = pose[bones * 4 + 2]!;
    } else {
      const p = parent * 9;
      for (let r = 0; r < 3; r++) {
        const a = rot[p + r * 3]!;
        const b = rot[p + r * 3 + 1]!;
        const c = rot[p + r * 3 + 2]!;
        rot[o + r * 3] = a * r0 + b * r3 + c * r6;
        rot[o + r * 3 + 1] = a * r1 + b * r4 + c * r7;
        rot[o + r * 3 + 2] = a * r2 + b * r5 + c * r8;
      }
      const mine = rest[i]!;
      const theirs = rest[parent]!;
      const dx = mine[0] - theirs[0];
      const dy = mine[1] - theirs[1];
      const dz = mine[2] - theirs[2];
      pos[i * 3] = pos[parent * 3]! + rot[p]! * dx + rot[p + 1]! * dy + rot[p + 2]! * dz;
      pos[i * 3 + 1] = pos[parent * 3 + 1]! + rot[p + 3]! * dx + rot[p + 4]! * dy + rot[p + 5]! * dz;
      pos[i * 3 + 2] = pos[parent * 3 + 2]! + rot[p + 6]! * dx + rot[p + 7]! * dy + rot[p + 8]! * dz;
    }
  }
  return skeleton;
}

/** The matrix of every bone for the graphics card, by columns: move to the joint, rotate, undo the rest position. */
export function skinMatrices(character: Character, skeleton: Skeleton, out: Float32Array): Float32Array {
  const rest = character.meta.bones.rest;
  const { rot, pos } = skeleton;
  for (let i = 0; i < character.bones; i++) {
    const o = i * 9;
    const m = i * 16;
    const at = rest[i]!;
    out[m] = rot[o]!;
    out[m + 1] = rot[o + 3]!;
    out[m + 2] = rot[o + 6]!;
    out[m + 3] = 0;
    out[m + 4] = rot[o + 1]!;
    out[m + 5] = rot[o + 4]!;
    out[m + 6] = rot[o + 7]!;
    out[m + 7] = 0;
    out[m + 8] = rot[o + 2]!;
    out[m + 9] = rot[o + 5]!;
    out[m + 10] = rot[o + 8]!;
    out[m + 11] = 0;
    out[m + 12] = pos[i * 3]! - (rot[o]! * at[0] + rot[o + 1]! * at[1] + rot[o + 2]! * at[2]);
    out[m + 13] = pos[i * 3 + 1]! - (rot[o + 3]! * at[0] + rot[o + 4]! * at[1] + rot[o + 5]! * at[2]);
    out[m + 14] = pos[i * 3 + 2]! - (rot[o + 6]! * at[0] + rot[o + 7]! * at[1] + rot[o + 8]! * at[2]);
    out[m + 15] = 1;
  }
  return out;
}

/** A point given in the axes of a bone, in the axes of the character. */
export function boneToCharacter(
  skeleton: Skeleton,
  bone: number,
  local: readonly [number, number, number],
  out: [number, number, number],
): [number, number, number] {
  const o = bone * 9;
  const { rot, pos } = skeleton;
  out[0] = pos[bone * 3]! + rot[o]! * local[0] + rot[o + 1]! * local[1] + rot[o + 2]! * local[2];
  out[1] = pos[bone * 3 + 1]! + rot[o + 3]! * local[0] + rot[o + 4]! * local[1] + rot[o + 5]! * local[2];
  out[2] = pos[bone * 3 + 2]! + rot[o + 6]! * local[0] + rot[o + 7]! * local[1] + rot[o + 8]! * local[2];
  return out;
}
