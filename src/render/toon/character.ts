/**
 * The character: one small mesh with a skeleton, shared by everybody on
 * court, and its animation clips. It comes in a single file made by the
 * Blender scripts in design/prueba-3d (magic `PAD1`, a JSON header, then the
 * numbers). The contract is in the README of that folder.
 *
 * A pose is, for every bone, a rotation relative to its parent (a quaternion)
 * plus the position of the pelvis. The skeleton has no rest rotations: with
 * every rotation at identity the character stands in its T pose.
 *
 * The character's own axes, in metres at life size: it stands on the origin
 * facing -y, with x to its left and z up.
 *
 * Everybody shares the mesh, the skeleton and the clips. What makes Beto
 * Beto is a handful of numbers in the same file: a palette, a few optional
 * pieces (a cap, a moustache), a scale for some bones (a belly), a posture,
 * and how fast and how wide he gestures. That is a `Style`.
 */
type Vec3 = [number, number, number];

export interface ClipInfo {
  name: string;
  /** Seconds. */
  dur: number;
  loop: boolean;
  frames: number;
  /** Offset so that one frame falls exactly on the contact. */
  t0?: number;
  grupo?: 'base' | 'locomocion' | 'golpe' | 'reaccion' | 'mania';

  // ---- ways of moving
  /** Metres one whole cycle covers, at life size. */
  zancada?: number;
  /** Which way the cycle goes, in the character's axes: [0, -1] is forward. */
  dir?: [number, number];
  /** The part of the cycle (0..1) it is best to come in at from standing. */
  entrada?: number;
  /** When each foot is on the floor: [which, from, to], in seconds of the clip. */
  apoyos?: Array<[string, number, number]>;
  /** A start or a stop: how far it gets, and how far it has got at every frame. */
  raiz?: { dir: [number, number]; total: number; dist: number[] };
  /** Which cycle a start ends in, or a stop comes out of, and at which part of it. */
  enlace?: { clip: string; fase: number };
  /** A stop: from this moment on it no longer advances. */
  libre?: number;
  /** The little hop before the rival hits: when the feet land, and from when it can be cut short. */
  aterrizaje?: number;
  corte?: number;

  // ---- strokes
  /** The moment the racket meets the ball. */
  contact?: number;
  /** Where the middle of the racket is at that moment, and the wrist. */
  hit?: Vec3;
  mano?: Vec3;
  /** The windup: [from, to]. It ends in a pause, and it is the part that can be stretched or held. */
  armado?: [number, number];
  lado?: 'derecha' | 'reves';
  /** A stroke for a ball that is only just reached. */
  estirada?: boolean;
  /** The serve: where the free hand has the ball at the start and when it lets go, and when that is. */
  ballHold?: [Vec3, Vec3];
  release?: number;

  /** Stretches with an expression on the face: [from, to, which]. */
  caras?: Array<[number, number, string]>;
}

export interface Clip extends ClipInfo {
  /** Per frame: a quaternion for every bone, then the pelvis. */
  samples: Float32Array;
}

/** What the file says about one of the cast. */
interface CastEntry {
  paleta: string;
  piezas: string[];
  escala: number;
  tempo: number;
  amplitud: number;
  mania: string | null;
  huesos: Record<string, { s: Vec3; d: Vec3 }>;
  /** Degrees per bone: lean forward, turn to the left, roll. */
  postura: Record<string, Vec3>;
}

export interface CharacterMeta {
  version: number;
  mesh: {
    nv: number;
    /** Indices of the base body plus the braid: all there is in a file of the first version. */
    ni: number;
    /** Every index in the file, and how many of them are the base body. */
    nt?: number;
    base?: number;
    center: Vec3;
    half: Vec3;
    pos: number;
    nrm: number;
    mat: number;
    out: number;
    joints: number;
    weights: number;
    idx: number;
    /** Optional pieces, after the base body: where each starts among the indices and how many it has. */
    piezas?: Array<{ nombre: string; inicio: number; cantidad: number }>;
    /** Faces: which vertices move, and by how much for every expression. */
    morfos?: { inicio: number; cantidad: number; nombres: string[]; datos: number };
  };
  materials: string[];
  /** Materials drawn flat, without the light steps: eyes, brows, mouth. */
  flat: boolean[];
  /** A colour for every material, for every look that came in the file. */
  palettes: Record<string, Vec3[]>;
  ink: Vec3;
  shadowTint: Vec3;
  lightGain: Vec3;
  rimColor: Vec3;
  bones: { names: string[]; parents: number[]; rest: Vec3[] };
  /** Middle of the racket head, in the axes of the racket bone. */
  racketCenter: Vec3;
  fps: number;
  personajes?: Record<string, CastEntry>;
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
  /** The pose everything is measured from when a gesture is made wider or smaller: standing ready. */
  ready: Float32Array | null;
  /** The bones of the trunk and the arms: what a wider gesture moves more. */
  upper: number[];
  bone(name: string): number;
}

/** What is one character's own, ready to use. */
export interface Style {
  /** The name of its palette in the file. */
  palette: string;
  /** Its size next to everybody else's. */
  size: number;
  /** How fast it goes through its gestures, and how wide it makes them. */
  tempo: number;
  amplitude: number;
  /** The clip of its tic between points, if it has one of its own. */
  mania: string | null;
  /** For every bone: how much its part of the mesh is scaled and shifted. Null when nothing is. */
  scale: Float32Array | null;
  shift: Float32Array | null;
  /** Bones with an extra turn: [bone, quaternion]. */
  posture: Array<[number, Float32Array]>;
  /** What to draw of the mesh: [first index, how many]. */
  parts: Array<[number, number]>;
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
  const ready = clips.listo ? clips.listo.samples.slice(0, channels) : null;
  const upper = ['spine', 'chest', 'neck', 'head', 'clav.L', 'clav.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R']
    .map((name) => names.indexOf(name))
    .filter((bone) => bone >= 0);
  return {
    meta,
    pos: new Int16Array(buffer, base + mesh.pos, mesh.nv * 3),
    nrm: new Int8Array(buffer, base + mesh.nrm, mesh.nv * 3),
    mat: new Uint8Array(buffer, base + mesh.mat, mesh.nv),
    out: new Uint8Array(buffer, base + mesh.out, mesh.nv),
    joints: new Uint8Array(buffer, base + mesh.joints, mesh.nv * 3),
    weights: new Uint8Array(buffer, base + mesh.weights, mesh.nv * 2),
    idx: new Uint16Array(buffer, base + mesh.idx, mesh.nt ?? mesh.ni),
    clips,
    bones,
    poseSize: channels,
    ready,
    upper,
    bone: (name) => names.indexOf(name),
  };
}

/**
 * What is one character's own. `name` is its entry in the file (`beto`,
 * `jugador`); a file with no cast, or a name it does not have, gives somebody
 * plain with the palette of that name if there is one.
 */
export function styleOf(character: Character, name: string): Style {
  const meta = character.meta;
  const entry = meta.personajes?.[name];
  const mesh = meta.mesh;
  const style: Style = {
    // A file with no cast: the palette of that name, or the rival's for anybody who is not the person's own player.
    palette: entry?.paleta ?? (meta.palettes[name] ? name : name !== 'jugador' && meta.palettes.rival ? 'rival' : (Object.keys(meta.palettes)[0] ?? name)),
    size: entry?.escala ?? 1,
    tempo: entry?.tempo ?? 1,
    amplitude: entry?.amplitud ?? 1,
    mania: entry?.mania ?? null,
    scale: null,
    shift: null,
    posture: [],
    parts: [[0, mesh.ni]],
  };
  if (mesh.piezas && mesh.base !== undefined) {
    const wanted = entry ? entry.piezas : ['trenza'];
    style.parts = [[0, mesh.base]];
    for (const piece of mesh.piezas) {
      if (!wanted.includes(piece.nombre) || piece.cantidad <= 0) continue;
      // Pieces that follow one another are drawn in one go.
      const last = style.parts[style.parts.length - 1]!;
      if (last[0] + last[1] === piece.inicio) last[1] += piece.cantidad;
      else style.parts.push([piece.inicio, piece.cantidad]);
    }
  }
  if (!entry) return style;
  const bones = character.bones;
  if (Object.keys(entry.huesos).length > 0) {
    style.scale = new Float32Array(bones * 3).fill(1);
    style.shift = new Float32Array(bones * 3);
    for (const [bone, change] of Object.entries(entry.huesos)) {
      const i = character.bone(bone);
      if (i < 0) continue;
      style.scale.set(change.s, i * 3);
      style.shift.set(change.d, i * 3);
    }
  }
  for (const [bone, turn] of Object.entries(entry.postura)) {
    const i = character.bone(bone);
    if (i >= 0) style.posture.push([i, eulerQuaternion(turn[0], turn[1], turn[2])]);
  }
  return style;
}

/** A lean forward, a turn to the left and a roll, in degrees, as one rotation: Rz(turn) Rx(lean) Ry(roll). */
function eulerQuaternion(lean: number, turn: number, roll: number): Float32Array {
  const k = Math.PI / 360;
  const out = new Float32Array(4);
  const half = new Float32Array(4);
  multiplyQuaternions([0, 0, Math.sin(turn * k), Math.cos(turn * k)], 0, [Math.sin(lean * k), 0, 0, Math.cos(lean * k)], 0, half, 0);
  multiplyQuaternions(half, 0, [0, Math.sin(roll * k), 0, Math.cos(roll * k)], 0, out, 0);
  return out;
}

/** out = a times b: the turn of b first, then the one of a. `out` may be `a` or `b`. */
export function multiplyQuaternions(
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  out: Float32Array | number[],
  oo: number,
): void {
  const ax = a[ao]!;
  const ay = a[ao + 1]!;
  const az = a[ao + 2]!;
  const aw = a[ao + 3]!;
  const bx = b[bo]!;
  const by = b[bo + 1]!;
  const bz = b[bo + 2]!;
  const bw = b[bo + 3]!;
  out[oo] = aw * bx + ax * bw + ay * bz - az * by;
  out[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
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

/**
 * Makes a pose wider or smaller: how far the trunk and the arms are from
 * standing ready is multiplied by `amplitude`. It is what makes the same
 * gesture look different on each of the cast.
 */
export function widen(character: Character, pose: Float32Array, amplitude: number): Float32Array {
  const ready = character.ready;
  if (amplitude === 1 || !ready) return pose;
  for (const i of character.upper) {
    const k = i * 4;
    const dot = pose[k]! * ready[k]! + pose[k + 1]! * ready[k + 1]! + pose[k + 2]! * ready[k + 2]! + pose[k + 3]! * ready[k + 3]!;
    const sign = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) pose[k + c] = ready[k + c]! + (pose[k + c]! * sign - ready[k + c]!) * amplitude;
  }
  return pose;
}

const turned = new Float32Array(4);

/** The way a character stands: its extra turns go on top of whatever the pose has. */
export function stand(pose: Float32Array, style: Style): Float32Array {
  for (const [bone, turn] of style.posture) {
    multiplyQuaternions(pose, bone * 4, turn, 0, turned, 0);
    pose.set(turned, bone * 4);
  }
  return pose;
}

const qa = new Float32Array(4);
const qb = new Float32Array(4);
const qc = new Float32Array(4);
const qz = new Float32Array(4);
const hipsSpine = new Float32Array(4);

/**
 * Running at an angle with a cycle that goes straight: the pelvis, and the
 * legs with it, turn toward where the body is going, and the spine and the
 * chest turn back between them, so the chest still faces the net. `angle` is
 * in radians, to the character's left.
 */
export function twistHips(character: Character, pose: Float32Array, angle: number): Float32Array {
  const hips = character.bone('hips') * 4;
  const spine = character.bone('spine') * 4;
  const chest = character.bone('chest') * 4;
  if (angle === 0 || hips < 0 || spine < 0 || chest < 0) return pose;
  const conjugate = (q: ArrayLike<number>, o: number, out: Float32Array): void => {
    out[0] = -q[o]!;
    out[1] = -q[o + 1]!;
    out[2] = -q[o + 2]!;
    out[3] = q[o + 3]!;
  };
  // Half of the way back for the spine: h* z(-a/2) h s.
  qz[0] = 0;
  qz[1] = 0;
  qz[2] = Math.sin(-angle / 4);
  qz[3] = Math.cos(-angle / 4);
  conjugate(pose, hips, qa);
  multiplyQuaternions(qa, 0, qz, 0, qb, 0);
  multiplyQuaternions(qb, 0, pose, hips, qc, 0);
  // The other half for the chest, measured with the pelvis and the spine as they were.
  multiplyQuaternions(pose, hips, pose, spine, hipsSpine, 0);
  multiplyQuaternions(qc, 0, pose, spine, qb, 0);
  pose.set(qb, spine);
  conjugate(hipsSpine, 0, qa);
  multiplyQuaternions(qa, 0, qz, 0, qb, 0);
  multiplyQuaternions(qb, 0, hipsSpine, 0, qc, 0);
  multiplyQuaternions(qc, 0, pose, chest, qb, 0);
  pose.set(qb, chest);
  // And the pelvis itself: z(a) h.
  qz[2] = Math.sin(angle / 2);
  qz[3] = Math.cos(angle / 2);
  multiplyQuaternions(qz, 0, pose, hips, qb, 0);
  pose.set(qb, hips);
  return pose;
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
 * in the character's own axes. Parents come before their children in the
 * file. A bone that is scaled for this character also pushes its children
 * further away.
 */
export function solveSkeleton(character: Character, pose: Float32Array, skeleton: Skeleton, style?: Style | null): Skeleton {
  const { parents, rest } = character.meta.bones;
  const bones = character.bones;
  const { rot, pos } = skeleton;
  const scale = style?.scale ?? null;
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
      let dx = mine[0] - theirs[0];
      let dy = mine[1] - theirs[1];
      let dz = mine[2] - theirs[2];
      if (scale) {
        dx *= scale[parent * 3]!;
        dy *= scale[parent * 3 + 1]!;
        dz *= scale[parent * 3 + 2]!;
      }
      pos[i * 3] = pos[parent * 3]! + rot[p]! * dx + rot[p + 1]! * dy + rot[p + 2]! * dz;
      pos[i * 3 + 1] = pos[parent * 3 + 1]! + rot[p + 3]! * dx + rot[p + 4]! * dy + rot[p + 5]! * dz;
      pos[i * 3 + 2] = pos[parent * 3 + 2]! + rot[p + 6]! * dx + rot[p + 7]! * dy + rot[p + 8]! * dz;
    }
  }
  return skeleton;
}

/**
 * The matrix of every bone for the graphics card, by columns: undo the rest
 * position, scale this character's part of the mesh, rotate, and move to the
 * joint.
 */
export function skinMatrices(character: Character, skeleton: Skeleton, out: Float32Array, style?: Style | null): Float32Array {
  const rest = character.meta.bones.rest;
  const { rot, pos } = skeleton;
  const scale = style?.scale ?? null;
  const shift = style?.shift ?? null;
  for (let i = 0; i < character.bones; i++) {
    const o = i * 9;
    const m = i * 16;
    const at = rest[i]!;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    let ox = at[0];
    let oy = at[1];
    let oz = at[2];
    if (scale && shift) {
      sx = scale[i * 3]!;
      sy = scale[i * 3 + 1]!;
      sz = scale[i * 3 + 2]!;
      ox = ox * sx - shift[i * 3]!;
      oy = oy * sy - shift[i * 3 + 1]!;
      oz = oz * sz - shift[i * 3 + 2]!;
    }
    out[m] = rot[o]! * sx;
    out[m + 1] = rot[o + 3]! * sx;
    out[m + 2] = rot[o + 6]! * sx;
    out[m + 3] = 0;
    out[m + 4] = rot[o + 1]! * sy;
    out[m + 5] = rot[o + 4]! * sy;
    out[m + 6] = rot[o + 7]! * sy;
    out[m + 7] = 0;
    out[m + 8] = rot[o + 2]! * sz;
    out[m + 9] = rot[o + 5]! * sz;
    out[m + 10] = rot[o + 8]! * sz;
    out[m + 11] = 0;
    out[m + 12] = pos[i * 3]! - (rot[o]! * ox + rot[o + 1]! * oy + rot[o + 2]! * oz);
    out[m + 13] = pos[i * 3 + 1]! - (rot[o + 3]! * ox + rot[o + 4]! * oy + rot[o + 5]! * oz);
    out[m + 14] = pos[i * 3 + 2]! - (rot[o + 6]! * ox + rot[o + 7]! * oy + rot[o + 8]! * oz);
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
